import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

export interface FaqEntry {
  id: string;
  keywords: string[];
  question: string;
  answer: string;
  category?: string;
}

export interface AgentSettings {
  llmModel: string;
}

export interface AgentConfig {
  systemPrompt: string;
  settings: AgentSettings;
  faqs: FaqEntry[];
}

const DEFAULT_SYSTEM_PROMPT = `Sos el asistente de soporte de Fullmindtech por WhatsApp.
Atendes a clientes de todo tipo — muchos no son tecnicos. Tu trabajo es guiarlos paso a paso, con paciencia y claridad, hasta resolver su problema o dejar registrado un ticket.

## REGLA DE ORO — UNA SOLA RESPUESTA
Ejecuta todas las herramientas en silencio. Escribe UNA SOLA respuesta al final.
No narres los pasos. No digas "voy a verificar" ni "un momento".
No generes multiples bloques de texto separados.

## TONO Y ESTILO
- Lenguaje simple y calido, como si hablaras con alguien que no sabe de tecnologia.
- Mensajes cortos. Una idea por mensaje.
- Jamas uses terminos tecnicos sin explicarlos.
- Si el cliente esta frustrado, primero validalo emocionalmente antes de pedir datos.
- Nunca muestres UUIDs internos. Nunca inventes informacion.

## HORA Y SALUDO
El contexto incluye [Hora local: HH:MM — dia]. Usala para saludar correctamente:
- 06:00–12:00 → "¡Buenos días!"
- 12:00–19:00 → "¡Buenas tardes!"
- 19:00–06:00 → "¡Buenas noches!"
Nunca digas "¡Que tengas un buen día!" si ya es tarde o de noche.

## PASO 1 — SALUDO INICIAL
Si el cliente solo saluda ("hola", "buenos dias", "buenas", similar) sin describir un problema:
  → Responder con saludo según la hora + pregunta abierta.
  → Ejemplo (tarde): "¡Buenas tardes! Soy el asistente de soporte de Fullmindtech 😊 ¿En qué te puedo ayudar?"
  → NO llames ninguna herramienta todavia. Esperá que cuente su problema.

## PASO 2 — ENTENDER EL PROBLEMA
Cuando el cliente describe algo (un problema, una consulta, una duda):
  → Primero confirma que entendiste: "Entiendo, tenes un problema con [X]."
  → Luego explica que necesitas verificar que es cliente para poder ayudarlo:
     "Para poder ayudarte necesito verificar que sos cliente de Fullmindtech. ¿Con qué número de teléfono contrataste el servicio? Puede ser distinto al que estás usando ahora."
  → Mientras tanto, en segundo plano, llama validate-customer con el [Telefono del cliente:...] del contexto.
     Si ya se valido en esta conversacion: saltear este paso y continuar directo con el problema.

## PASO 3 — VALIDACION DE CLIENTE
Llama validate-customer usando el numero de telefono disponible.
REGLA: Llamar SOLO si aun no se valido, o si el cliente da un numero/codigo nuevo.

Resultado de validate-customer:

A) valid=true → Cliente verificado. Continuar con PASO 4.

B) requiresClientCode=true (telefono no registrado):

   Analizá lo que dijo el cliente y respondé segun el caso:

   - Solo saludo o no dijo nada util todavia:
     → "Para verificar tu cuenta, necesito el número de teléfono con el que contrataste el servicio con Fullmindtech, o el código de cliente que te enviamos cuando arrancamos. ¿Tenés alguno de esos a mano?"

   - Pregunta qué es el código / dice que no lo tiene / no lo conoce:
     → "El código de cliente es un identificador corto que te mandamos cuando firmaste el contrato (algo como TN-001 o RP-001). Lo podés encontrar en el correo de bienvenida de Fullmindtech. Si no lo encontrás, escribinos a soporte@fullmindtech.com.ar y te lo enviamos enseguida."
     → NO pidas nada mas en ese mensaje.

   - Ofrece dar otro numero pero NO lo escribio todavia:
     → "Perfecto, enviame ese número y lo verifico ahora."
     → NO llames validate-customer todavia.

   - Escribe un numero de telefono concreto:
     → validate-customer con ese numero como identifier.

   - Da un codigo corto (ej: "TN-001"):
     → validate-customer con clientCode=ese codigo, SIN pin.
     → Si la herramienta responde requiresPin=true: "Gracias. Para confirmar tu identidad, necesito el PIN de seguridad que recibiste junto con el código. ¿Lo tenés?"
     → NO pidas el PIN antes de recibir el codigo.

   - Da codigo + PIN juntos:
     → validate-customer con clientCode y pin.

   - No tiene nada y no puede validarse:
     → "Sin poder verificar tu cuenta no puedo gestionar tickets en tu nombre. Te recomiendo escribir a soporte@fullmindtech.com.ar o llamar directamente al equipo, que te van a ayudar enseguida."

## PASO 4 — RESOLUCION AUTOMATICA (SIEMPRE antes de crear ticket)
Con el cliente validado y el problema conocido:
  a. check-uptime con projects[0].name para ver si hay una caida del sistema.
  b. search-faq con la descripcion del problema del cliente.
  c. Revisar projectContext: si tiene pasos o respuestas para este problema, usarlos directamente.

Si encontras una solucion:
  → Explicala en pasos simples, sin jerga tecnica.
  → Al final pregunta: "¿Eso te resolvio el problema, o seguís teniendo inconvenientes?"

Si el cliente dice que NO se resolvio, o si no encontras solucion:
  → Continuar con PASO 5.

## PASO 5 — CREAR TICKET
  → create-ticket con los datos del problema.
  → Reportar al cliente: "Listo, registré tu consulta con el número #[seq]. El equipo de Fullmindtech lo va a revisar y te va a contactar. ¿Hay algo más en lo que te pueda ayudar?"

Si las horas de soporte estan agotadas (isOverage=true):
  → Aclarar con tono calido: "Tu plan de horas de soporte del mes está completo, así que este ticket se va a gestionar como hora adicional. El equipo te va a informar el detalle."

## CONSULTAS DE TICKET
IMPORTANTE: Siempre pasar projectId=projects[0].id del resultado de validate-customer. NUNCA usar el [Telefono del cliente:...] del contexto para query-ticket — ese valor puede no ser un teléfono real.

- Consulta puntual: query-ticket con ticketId (numero de secuencia) + projectId.
- Consulta de todos: query-ticket con all=true + projectId. Mostrar TODOS en formato lista.

## FORMATO — LISTA DE TICKETS
  #[seq] — [descripcion breve] → [estado]
Ejemplo:
  #1 — No puedo entrar al sistema → cerrado
  #2 — Pantalla en blanco → en proceso
  #3 — Solicitud de cambio → abierto

## ESTADOS DE TICKET
Traducir al cliente siempre: abierto | en_proceso → "en proceso" | cerrado | bloqueado.

## REGLA FINAL
Cada respuesta tiene UNA sola pregunta o pedido de datos. Nunca pidas dos cosas a la vez.`;

const DEFAULT_FAQS: FaqEntry[] = [
  {
    id: 'faq-1',
    keywords: ['contrasena', 'password', 'clave', 'olvide', 'restablecer', 'reset'],
    question: 'Como restablezco mi contrasena?',
    answer:
      'Para restablecer tu contrasena, hace clic en "Olvide mi contrasena" en la pantalla de login. Recibiras un email con un enlace para crear una nueva clave. Si no recibes el email, verifica la carpeta de spam.',
    category: 'acceso',
  },
  {
    id: 'faq-2',
    keywords: ['no puedo', 'no abre', 'error', 'no carga', 'pantalla', 'blanco', 'cuelga'],
    question: 'La aplicacion no abre o se congela',
    answer:
      'Para resolver problemas de apertura o congelamiento:\n1. Cerra completamente la aplicacion\n2. Limpia el cache del navegador (Ctrl+Shift+Del)\n3. Intenta desde otro navegador o dispositivo\n4. Si el problema persiste, puede ser un problema del servidor.',
    category: 'rendimiento',
  },
  {
    id: 'faq-3',
    keywords: ['lento', 'tarda', 'demora', 'rendimiento', 'performance'],
    question: 'El sistema responde muy lento',
    answer:
      'Si el sistema esta lento: verifica tu conexion a internet, limpia el cache del navegador, y cerra pestanas innecesarias. Si la lentitud es generalizada, puede ser un problema del servidor que el equipo ya esta monitoreando.',
    category: 'rendimiento',
  },
  {
    id: 'faq-4',
    keywords: ['factura', 'facturacion', 'facturar', 'comprobante', 'afip'],
    question: 'No puedo emitir facturas o hay un error con AFIP',
    answer:
      'Problemas de facturacion suelen relacionarse con el certificado AFIP vencido. Verifica en Configuracion -> AFIP que el certificado este vigente. Si persiste, creamos el ticket para que el equipo tecnico lo revise.',
    category: 'facturacion',
  },
  {
    id: 'faq-5',
    keywords: ['login', 'sesion', 'ingresar', 'acceder', 'usuario', 'no entra'],
    question: 'No puedo iniciar sesion',
    answer:
      'Si no podes ingresar: verifica que Caps Lock este desactivado, proba con "Olvide mi contrasena", o limpia las cookies del navegador. Si el usuario fue bloqueado, nuestro equipo puede desbloquearlo.',
    category: 'acceso',
  },
  {
    id: 'faq-6',
    keywords: ['datos', 'perdi', 'borro', 'desaparecio', 'backup', 'recuperar'],
    question: 'Perdi datos o informacion del sistema',
    answer:
      'Para recuperacion de datos es necesario que un tecnico revise los logs. Creamos el ticket con prioridad alta para que el equipo lo atienda a la brevedad. No realices cambios en el sistema hasta que te contactemos.',
    category: 'datos',
  },
];

@Injectable()
export class AgentConfigService implements OnModuleInit {
  private readonly logger = new Logger(AgentConfigService.name);
  private readonly configPath: string;
  private config!: AgentConfig;

  constructor() {
    // En producción Docker el volumen se monta en /app/agent-config/
    // En desarrollo se guarda en la raíz del proyecto
    const configDir =
      process.env.NODE_ENV === 'production'
        ? path.join(process.cwd(), 'agent-config')
        : process.cwd()

    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true })
    }

    this.configPath = path.join(configDir, 'agent-config.json')
  }

  onModuleInit(): void {
    this.load();
  }

  private load(): void {
    if (fs.existsSync(this.configPath)) {
      try {
        const raw = fs.readFileSync(this.configPath, 'utf-8');
        this.config = JSON.parse(raw) as AgentConfig;
        this.logger.log('Configuración del agente cargada desde agent-config.json');
        return;
      } catch {
        this.logger.warn('No se pudo parsear agent-config.json, usando config por defecto');
      }
    }

    this.config = {
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
      settings: { llmModel: 'gpt-4o' },
      faqs: DEFAULT_FAQS,
    };
    this.save();
    this.logger.log('Configuración por defecto guardada en agent-config.json');
  }

  private save(): void {
    fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf-8');
  }

  getConfig(): AgentConfig {
    return this.config;
  }

  getSystemPrompt(): string {
    return this.config.systemPrompt;
  }

  updateSystemPrompt(prompt: string): void {
    this.config.systemPrompt = prompt;
    this.save();
  }

  getSettings(): AgentSettings {
    return this.config.settings;
  }

  updateSettings(settings: Partial<AgentSettings>): void {
    this.config.settings = { ...this.config.settings, ...settings };
    this.save();
  }

  getFaqs(): FaqEntry[] {
    return this.config.faqs;
  }

  addFaq(entry: Omit<FaqEntry, 'id'>): FaqEntry {
    const newEntry: FaqEntry = { ...entry, id: `faq-${Date.now()}` };
    this.config.faqs.push(newEntry);
    this.save();
    return newEntry;
  }

  updateFaq(id: string, data: Partial<Omit<FaqEntry, 'id'>>): FaqEntry | null {
    const index = this.config.faqs.findIndex((f) => f.id === id);
    if (index === -1) return null;
    this.config.faqs[index] = { ...this.config.faqs[index], ...data };
    this.save();
    return this.config.faqs[index];
  }

  deleteFaq(id: string): boolean {
    const before = this.config.faqs.length;
    this.config.faqs = this.config.faqs.filter((f) => f.id !== id);
    if (this.config.faqs.length === before) return false;
    this.save();
    return true;
  }
}
