import {
  Controller,
  Get,
  Put,
  Post,
  Delete,
  Body,
  Param,
  Headers,
  UnauthorizedException,
  NotFoundException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgentConfigService } from './agent-config.service';
import { AgentService } from '../agent/agent.service';
import { UpdatePromptDto } from './dto/update-prompt.dto';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { CreateFaqDto, UpdateFaqDto } from './dto/faq.dto';

@Controller('admin')
export class AdminController {
  private readonly adminApiKey: string;

  constructor(
    private readonly agentConfigService: AgentConfigService,
    private readonly agentService: AgentService,
    private readonly config: ConfigService,
  ) {
    this.adminApiKey = this.config.getOrThrow<string>('ADMIN_API_KEY');
  }

  private checkAuth(apiKey: string | undefined): void {
    if (!apiKey || apiKey !== this.adminApiKey) {
      throw new UnauthorizedException('API key inválida');
    }
  }

  // ────────────────────────────────────────────
  // Config completa
  // ────────────────────────────────────────────

  @Get('config')
  getConfig(@Headers('x-admin-key') key: string) {
    this.checkAuth(key);
    return this.agentConfigService.getConfig();
  }

  // ────────────────────────────────────────────
  // Prompt
  // ────────────────────────────────────────────

  @Get('prompt')
  getPrompt(@Headers('x-admin-key') key: string) {
    this.checkAuth(key);
    return { prompt: this.agentConfigService.getSystemPrompt() };
  }

  @Put('prompt')
  updatePrompt(@Headers('x-admin-key') key: string, @Body() dto: UpdatePromptDto) {
    this.checkAuth(key);
    this.agentConfigService.updateSystemPrompt(dto.prompt);
    this.agentService.reloadAgent();
    return { ok: true, message: 'Prompt actualizado. Agente recargado.' };
  }

  // ────────────────────────────────────────────
  // Settings
  // ────────────────────────────────────────────

  @Get('settings')
  getSettings(@Headers('x-admin-key') key: string) {
    this.checkAuth(key);
    return this.agentConfigService.getSettings();
  }

  @Put('settings')
  updateSettings(@Headers('x-admin-key') key: string, @Body() dto: UpdateSettingsDto) {
    this.checkAuth(key);
    this.agentConfigService.updateSettings({ llmModel: dto.llmModel });
    this.agentService.reloadAgent();
    return { ok: true, message: 'Settings actualizados. Agente recargado.' };
  }

  // ────────────────────────────────────────────
  // FAQs
  // ────────────────────────────────────────────

  @Get('faqs')
  getFaqs(@Headers('x-admin-key') key: string) {
    this.checkAuth(key);
    return this.agentConfigService.getFaqs();
  }

  @Post('faqs')
  @HttpCode(HttpStatus.CREATED)
  createFaq(@Headers('x-admin-key') key: string, @Body() dto: CreateFaqDto) {
    this.checkAuth(key);
    const created = this.agentConfigService.addFaq(dto);
    return created;
  }

  @Put('faqs/:id')
  updateFaq(
    @Headers('x-admin-key') key: string,
    @Param('id') id: string,
    @Body() dto: UpdateFaqDto,
  ) {
    this.checkAuth(key);
    const updated = this.agentConfigService.updateFaq(id, dto);
    if (!updated) throw new NotFoundException(`FAQ con id "${id}" no encontrada`);
    return updated;
  }

  @Delete('faqs/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteFaq(@Headers('x-admin-key') key: string, @Param('id') id: string) {
    this.checkAuth(key);
    const deleted = this.agentConfigService.deleteFaq(id);
    if (!deleted) throw new NotFoundException(`FAQ con id "${id}" no encontrada`);
  }
}
