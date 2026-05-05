import { Module, forwardRef } from '@nestjs/common';
import { AgentConfigModule } from './agent-config.module';
import { AdminController } from './admin.controller';
import { AgentModule } from '../agent/agent.module';

@Module({
  imports: [AgentConfigModule, forwardRef(() => AgentModule)],
  controllers: [AdminController],
  exports: [AgentConfigModule],
})
export class AdminModule {}
