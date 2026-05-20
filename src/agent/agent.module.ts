import { Module, forwardRef } from '@nestjs/common';
import { AgentService } from './agent.service';
import { CustomersModule } from '../customers/customers.module';
import { HoursModule } from '../hours/hours.module';
import { TicketsModule } from '../tickets/tickets.module';
import { FaqModule } from '../faq/faq.module';
import { ConversationModule } from '../conversation/conversation.module';
import { PlaneModule } from '../integrations/plane/plane.module';
import { AgentConfigModule } from '../admin/agent-config.module';

@Module({
  imports: [
    CustomersModule,
    HoursModule,
    TicketsModule,
    FaqModule,
    ConversationModule,
    PlaneModule,
    AgentConfigModule,
  ],
  providers: [AgentService],
  exports: [AgentService],
})
export class AgentModule {}
