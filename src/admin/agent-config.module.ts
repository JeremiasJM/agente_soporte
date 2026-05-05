import { Module } from '@nestjs/common';
import { AgentConfigService } from './agent-config.service';

@Module({
  providers: [AgentConfigService],
  exports: [AgentConfigService],
})
export class AgentConfigModule {}
