import {
  Controller,
  Get,
  Put,
  Post,
  Delete,
  Body,
  Param,
  NotFoundException,
  HttpCode,
  HttpStatus,
  UseGuards,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import { AdminGuard } from './admin.guard';
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

  // ────────────────────────────────────────────
  // Auth (no guard — public endpoint)
  // ────────────────────────────────────────────

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() body: { password: string }) {
    if (!body.password || body.password !== this.adminApiKey) {
      throw new UnauthorizedException('Contraseña incorrecta');
    }

    const token = jwt.sign({ role: 'admin' }, this.adminApiKey, {
      expiresIn: '8h',
    });

    return { token };
  }

  // ────────────────────────────────────────────
  // Config completa
  // ────────────────────────────────────────────

  @Get('config')
  @UseGuards(AdminGuard)
  getConfig() {
    return this.agentConfigService.getConfig();
  }

  // ────────────────────────────────────────────
  // Prompt
  // ────────────────────────────────────────────

  @Get('prompt')
  @UseGuards(AdminGuard)
  getPrompt() {
    return { prompt: this.agentConfigService.getSystemPrompt() };
  }

  @Put('prompt')
  @UseGuards(AdminGuard)
  updatePrompt(@Body() dto: UpdatePromptDto) {
    this.agentConfigService.updateSystemPrompt(dto.prompt);
    this.agentService.reloadAgent();
    return { ok: true, message: 'Prompt actualizado. Agente recargado.' };
  }

  // ────────────────────────────────────────────
  // Settings
  // ────────────────────────────────────────────

  @Get('settings')
  @UseGuards(AdminGuard)
  getSettings() {
    return this.agentConfigService.getSettings();
  }

  @Put('settings')
  @UseGuards(AdminGuard)
  updateSettings(@Body() dto: UpdateSettingsDto) {
    this.agentConfigService.updateSettings({ llmModel: dto.llmModel });
    this.agentService.reloadAgent();
    return { ok: true, message: 'Settings actualizados. Agente recargado.' };
  }

  // ────────────────────────────────────────────
  // FAQs
  // ────────────────────────────────────────────

  @Get('faqs')
  @UseGuards(AdminGuard)
  getFaqs() {
    return this.agentConfigService.getFaqs();
  }

  @Post('faqs')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.CREATED)
  createFaq(@Body() dto: CreateFaqDto) {
    const created = this.agentConfigService.addFaq(dto);
    return created;
  }

  @Put('faqs/:id')
  @UseGuards(AdminGuard)
  updateFaq(@Param('id') id: string, @Body() dto: UpdateFaqDto) {
    const updated = this.agentConfigService.updateFaq(id, dto);
    if (!updated) throw new NotFoundException(`FAQ con id "${id}" no encontrada`);
    return updated;
  }

  @Delete('faqs/:id')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteFaq(@Param('id') id: string) {
    const deleted = this.agentConfigService.deleteFaq(id);
    if (!deleted) throw new NotFoundException(`FAQ con id "${id}" no encontrada`);
  }
}
