import { Module } from '@nestjs/common';
import { WhatsappController } from './whatsapp.controller';
import { PlaneWebhookController } from './plane-webhook.controller';
import { AgentModule } from '../agent/agent.module';
import { MetaWhatsappModule } from '../integrations/meta/meta-whatsapp.module';
import { CustomersModule } from '../customers/customers.module';
import { PlaneModule } from '../integrations/plane/plane.module';
@Module({
  imports: [AgentModule, MetaWhatsappModule, CustomersModule, PlaneModule],
  controllers: [WhatsappController, PlaneWebhookController],
})
export class WebhooksModule {}
