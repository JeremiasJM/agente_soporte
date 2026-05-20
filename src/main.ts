import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { json } from 'express';
import { join } from 'path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Request, Response, NextFunction } from 'express';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  // Deshabilitar el bodyParser predeterminado para poder capturar el rawBody
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  const logger = new Logger('Bootstrap');

  // Middleware que registra el cuerpo crudo en req.rawBody (necesario para verificación HMAC de Meta)
  app.use(
    json({
      verify: (req: Request & { rawBody?: Buffer }, _res: Response, buf: Buffer) => {
        req.rawBody = buf;
      },
    }),
  );

  // Servir archivos estáticos desde /public → accesible en /widget.html, etc.
  app.useStaticAssets(join(process.cwd(), 'public'));

  // CORS: permitir el widget en localhost y en producción
  // ADMIN_UI_ORIGIN puede agregarse en .env (ej: http://localhost:5174)
  const allowedOrigins = (
    process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173,http://localhost:5174'
  )
    .split(',')
    .map((o) => o.trim());

  app.enableCors({
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // Permitir embebido en iframes de cualquier origen
  // (restringir con ALLOWED_FRAME_ANCESTORS en producción)
  const frameAncestors = process.env.ALLOWED_FRAME_ANCESTORS ?? '*';
  app.use((_req, res, next) => {
    res.removeHeader('X-Frame-Options'); // Nest/Express lo pone por defecto
    res.setHeader('Content-Security-Policy', `frame-ancestors ${frameAncestors}`);
    next();
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  logger.log(`Agente de Soporte escuchando en el puerto ${port}`);
  logger.log(`Webhook WhatsApp: POST /webhooks/whatsapp`);
  logger.log(`Webhook Plane:    POST /webhooks/plane`);
  logger.log(`Chat web:         POST /chat`);
  logger.log(`Widget web:       GET  /widget.html`);
}
bootstrap();
