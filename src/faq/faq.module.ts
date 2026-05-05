import { Module } from '@nestjs/common';
import { FaqService } from './faq.service';
import { PlaneModule } from '../integrations/plane/plane.module';
import { AgentConfigModule } from '../admin/agent-config.module';

@Module({
  imports: [PlaneModule, AgentConfigModule],
  providers: [FaqService],
  exports: [FaqService],
})
export class FaqModule {}
