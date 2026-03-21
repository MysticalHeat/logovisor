import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Patch,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiExtraModels,
  ApiTags,
} from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { OperatorAuthGuard } from '../auth/operator-auth.guard';
import { ApiStandardErrorResponses } from '../shared/error-response';
import { AlertsService } from './alerts.service';

class CreateTelegramIntegrationDto {
  @ApiProperty({ example: 'ops-main' })
  @IsString()
  name: string;

  @ApiProperty({ example: '123456:ABCDEF-token' })
  @IsString()
  botToken: string;

  @ApiProperty({ example: '-1001234567890' })
  @IsString()
  chatId: string;

  @ApiPropertyOptional({ example: '42' })
  @IsOptional()
  @IsString()
  threadId?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

class TelegramIntegrationItemDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  tokenPreview: string;

  @ApiProperty()
  chatId: string;

  @ApiPropertyOptional()
  threadId?: string;

  @ApiProperty()
  enabled: boolean;

  @ApiPropertyOptional()
  lastVerifiedAt?: string;

  @ApiProperty()
  createdAt: string;

  @ApiProperty()
  updatedAt: string;
}

class TelegramIntegrationListDto {
  @ApiProperty({ type: () => [TelegramIntegrationItemDto] })
  items: TelegramIntegrationItemDto[];

  @ApiProperty()
  count: number;
}

class TelegramIntegrationCreateResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  tokenPreview: string;
}

class TelegramIntegrationUpdateResponseDto {
  @ApiProperty()
  id: string;
}

class OkResponseDto {
  @ApiProperty()
  ok: boolean;
}

class TelegramIntegrationTestResponseDto {
  @ApiProperty()
  ok: boolean;

  @ApiProperty()
  description: string;
}

class CreateAlertRuleDto {
  @ApiProperty({
    example:
      'rule "error_spike" {\n  source = logs\n  where = level = "error"\n  window = 5m\n  trigger = count() >= 10\n  severity = "error"\n  message = "Too many errors"\n  notify = telegram("ops-main")\n}',
  })
  @IsString()
  dslText: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

class AlertRuleItemDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  source: string;

  @ApiProperty()
  severity: string;

  @ApiProperty()
  enabled: boolean;

  @ApiProperty()
  integrationId: string;

  @ApiProperty()
  dslText: string;

  @ApiProperty({ type: Object })
  compiledRule: Record<string, unknown>;

  @ApiProperty()
  createdAt: string;

  @ApiProperty()
  updatedAt: string;
}

class AlertRuleListDto {
  @ApiProperty({ type: () => [AlertRuleItemDto] })
  items: AlertRuleItemDto[];

  @ApiProperty()
  count: number;
}

class AlertRuleWriteResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  explanation: string;
}

class AlertDslValidationErrorDto {
  @ApiProperty()
  message: string;

  @ApiPropertyOptional()
  line?: number;

  @ApiPropertyOptional()
  column?: number;
}

class AlertDslValidationResponseDto {
  @ApiProperty()
  ok: boolean;

  @ApiPropertyOptional({ type: Object })
  compiledRule?: Record<string, unknown>;

  @ApiProperty({ type: () => [AlertDslValidationErrorDto] })
  errors: AlertDslValidationErrorDto[];

  @ApiProperty({ type: () => [String] })
  warnings: string[];

  @ApiPropertyOptional()
  explanation?: string;
}

class AlertDslMetadataResponseDto {
  @ApiProperty()
  version: string;

  @ApiProperty({ type: () => [String] })
  sources: string[];

  @ApiProperty({ type: () => [String] })
  operators: string[];

  @ApiProperty({ type: () => [String] })
  severities: string[];

  @ApiProperty({ type: () => [String] })
  functions: string[];

  @ApiProperty({ type: Object })
  fields: Record<string, string[]>;

  @ApiProperty({ type: () => [Object] })
  snippets: Array<Record<string, unknown>>;
}

class AlertIncidentItemDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  ruleId: string;

  @ApiProperty()
  subjectLabel: string;

  @ApiProperty()
  status: string;

  @ApiProperty()
  message: string;

  @ApiProperty()
  firstSeenAt: string;

  @ApiProperty()
  lastSeenAt: string;

  @ApiPropertyOptional()
  firedAt?: string;

  @ApiPropertyOptional()
  resolvedAt?: string;

  @ApiPropertyOptional()
  acknowledgedAt?: string;

  @ApiPropertyOptional()
  acknowledgedBy?: string;

  @ApiPropertyOptional()
  ackNote?: string;

  @ApiPropertyOptional()
  lastNotifiedAt?: string;
}

class AlertIncidentListDto {
  @ApiProperty({ type: () => [AlertIncidentItemDto] })
  items: AlertIncidentItemDto[];

  @ApiProperty()
  count: number;
}

class AlertNotificationItemDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  incidentId: string;

  @ApiProperty()
  integrationId: string;

  @ApiProperty()
  kind: string;

  @ApiProperty()
  state: string;

  @ApiProperty()
  attempts: string;

  @ApiPropertyOptional()
  lastError?: string;

  @ApiPropertyOptional()
  providerMessageId?: string;

  @ApiPropertyOptional()
  sentAt?: string;

  @ApiProperty()
  createdAt: string;
}

class AlertNotificationListDto {
  @ApiProperty({ type: () => [AlertNotificationItemDto] })
  items: AlertNotificationItemDto[];

  @ApiProperty()
  count: number;
}

class AlertSilenceItemDto {
  @ApiProperty()
  id: string;

  @ApiPropertyOptional()
  ruleId?: string;

  @ApiPropertyOptional()
  subjectType?: string;

  @ApiPropertyOptional()
  subjectId?: string;

  @ApiPropertyOptional()
  reason?: string;

  @ApiProperty()
  startsAt: string;

  @ApiProperty()
  endsAt: string;
}

class AlertSilenceListDto {
  @ApiProperty({ type: () => [AlertSilenceItemDto] })
  items: AlertSilenceItemDto[];

  @ApiProperty()
  count: number;
}

class AlertSilenceWriteResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  endsAt: string;
}

class AlertPreviewResponseDto {
  @ApiProperty()
  ok: boolean;

  @ApiPropertyOptional()
  explanation?: string;

  @ApiProperty({ type: () => [Object] })
  matches: Array<Record<string, unknown>>;

  @ApiProperty()
  count: number;
}

class UpdateTelegramIntegrationDto {
  @ApiPropertyOptional({ example: 'ops-main' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: '123456:ABCDEF-token' })
  @IsOptional()
  @IsString()
  botToken?: string;

  @ApiPropertyOptional({ example: '-1001234567890' })
  @IsOptional()
  @IsString()
  chatId?: string;

  @ApiPropertyOptional({ example: '42' })
  @IsOptional()
  @IsString()
  threadId?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

class UpdateAlertRuleDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  dslText?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

class ParseDslDto {
  @ApiProperty()
  @IsString()
  dslText: string;
}

class AckIncidentDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  acknowledgedBy?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ackNote?: string;
}

class CreateSilenceDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ruleId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  subjectType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  subjectId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiProperty({ example: 60 })
  @IsOptional()
  durationMinutes: number;
}

@Controller('admin/alerts')
@ApiTags('admin')
@ApiExtraModels(
  TelegramIntegrationItemDto,
  TelegramIntegrationListDto,
  TelegramIntegrationCreateResponseDto,
  TelegramIntegrationUpdateResponseDto,
  TelegramIntegrationTestResponseDto,
  AlertRuleItemDto,
  AlertRuleListDto,
  AlertRuleWriteResponseDto,
  AlertDslValidationResponseDto,
  AlertDslMetadataResponseDto,
  AlertIncidentItemDto,
  AlertIncidentListDto,
  AlertNotificationItemDto,
  AlertNotificationListDto,
  AlertSilenceItemDto,
  AlertSilenceListDto,
  AlertSilenceWriteResponseDto,
  AlertPreviewResponseDto,
  OkResponseDto,
)
@ApiCookieAuth('operator-session')
@UseGuards(OperatorAuthGuard)
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  @Get('telegram/integrations')
  @ApiOperation({ summary: 'List Telegram integrations' })
  @ApiOkResponse({
    description: 'Telegram integrations returned.',
    type: TelegramIntegrationListDto,
  })
  @ApiStandardErrorResponses(401)
  async listTelegramIntegrations(): Promise<{
    items: unknown[];
    count: number;
  }> {
    const items = await this.alertsService.listTelegramIntegrations();
    return { items, count: items.length };
  }

  @Post('telegram/integrations')
  @HttpCode(200)
  @ApiOperation({ summary: 'Create Telegram integration' })
  @ApiOkResponse({
    description: 'Telegram integration created.',
    type: TelegramIntegrationCreateResponseDto,
  })
  @ApiStandardErrorResponses(400, 401)
  async createTelegramIntegration(
    @Body() body: CreateTelegramIntegrationDto,
  ): Promise<{ id: string; tokenPreview: string }> {
    return this.alertsService.createTelegramIntegration(body);
  }

  @Patch('telegram/integrations/:id')
  @ApiOperation({ summary: 'Update Telegram integration' })
  @ApiOkResponse({
    description: 'Telegram integration updated.',
    type: TelegramIntegrationUpdateResponseDto,
  })
  @ApiStandardErrorResponses(400, 401)
  async updateTelegramIntegration(
    @Param('id') id: string,
    @Body() body: UpdateTelegramIntegrationDto,
  ): Promise<{ id: string }> {
    return this.alertsService.updateTelegramIntegration(id, body);
  }

  @Delete('telegram/integrations/:id')
  @ApiOperation({ summary: 'Delete Telegram integration' })
  @ApiOkResponse({
    description: 'Telegram integration deleted.',
    type: OkResponseDto,
  })
  @ApiStandardErrorResponses(400, 401)
  async deleteTelegramIntegration(
    @Param('id') id: string,
  ): Promise<{ ok: boolean }> {
    return this.alertsService.deleteTelegramIntegration(id);
  }

  @Post('telegram/integrations/:id/test')
  @HttpCode(200)
  @ApiOperation({ summary: 'Send Telegram test message' })
  @ApiOkResponse({
    description: 'Telegram test sent.',
    type: TelegramIntegrationTestResponseDto,
  })
  @ApiStandardErrorResponses(400, 401)
  async testTelegramIntegration(
    @Param('id') id: string,
  ): Promise<{ ok: boolean; description: string }> {
    return this.alertsService.testTelegramIntegration(id);
  }

  @Get('rules')
  @ApiOperation({ summary: 'List alert rules' })
  @ApiOkResponse({
    description: 'Alert rules returned.',
    type: AlertRuleListDto,
  })
  @ApiStandardErrorResponses(401)
  async listRules(): Promise<{ items: unknown[]; count: number }> {
    const items = await this.alertsService.listRules();
    return { items, count: items.length };
  }

  @Post('rules')
  @HttpCode(200)
  @ApiOperation({ summary: 'Create alert rule from DSL' })
  @ApiOkResponse({
    description: 'Alert rule created.',
    type: AlertRuleWriteResponseDto,
  })
  @ApiStandardErrorResponses(400, 401)
  async createRule(
    @Body() body: CreateAlertRuleDto,
  ): Promise<{ id: string; explanation: string }> {
    return this.alertsService.createRule(body);
  }

  @Patch('rules/:id')
  @ApiOperation({ summary: 'Update alert rule from DSL' })
  @ApiOkResponse({
    description: 'Alert rule updated.',
    type: AlertRuleWriteResponseDto,
  })
  @ApiStandardErrorResponses(400, 401)
  async updateRule(
    @Param('id') id: string,
    @Body() body: UpdateAlertRuleDto,
  ): Promise<{ id: string; explanation: string }> {
    return this.alertsService.updateRule(id, body);
  }

  @Delete('rules/:id')
  @ApiOperation({ summary: 'Delete alert rule' })
  @ApiOkResponse({ description: 'Alert rule deleted.', type: OkResponseDto })
  @ApiStandardErrorResponses(400, 401)
  async deleteRule(@Param('id') id: string): Promise<{ ok: boolean }> {
    return this.alertsService.deleteRule(id);
  }

  @Post('parse')
  @HttpCode(200)
  @ApiOperation({ summary: 'Parse and validate alert DSL' })
  @ApiOkResponse({
    description: 'DSL validation result returned.',
    type: AlertDslValidationResponseDto,
  })
  @ApiStandardErrorResponses(400, 401)
  async parseDsl(@Body() body: ParseDslDto): Promise<unknown> {
    return this.alertsService.parseDsl(body.dslText);
  }

  @Get('dsl-metadata')
  @ApiOperation({ summary: 'Get alert DSL metadata and snippets' })
  @ApiOkResponse({
    description: 'DSL metadata returned.',
    type: AlertDslMetadataResponseDto,
  })
  @ApiStandardErrorResponses(401)
  getDslMetadata(): Record<string, unknown> {
    return this.alertsService.getDslMetadata();
  }

  @Get('incidents')
  @ApiOperation({ summary: 'List alert incidents' })
  @ApiOkResponse({
    description: 'Alert incidents returned.',
    type: AlertIncidentListDto,
  })
  @ApiStandardErrorResponses(401)
  async listIncidents(): Promise<{ items: unknown[]; count: number }> {
    const items = await this.alertsService.listIncidents();
    return { items, count: items.length };
  }

  @Get('notifications')
  @ApiOperation({ summary: 'List alert notification history' })
  @ApiOkResponse({
    description: 'Alert notification history returned.',
    type: AlertNotificationListDto,
  })
  @ApiStandardErrorResponses(401)
  async listNotifications(): Promise<{ items: unknown[]; count: number }> {
    const items = await this.alertsService.listNotificationHistory();
    return { items, count: items.length };
  }

  @Post('preview')
  @HttpCode(200)
  @ApiOperation({ summary: 'Preview alert rule on recent data' })
  @ApiOkResponse({
    description: 'Alert preview returned.',
    type: AlertPreviewResponseDto,
  })
  @ApiStandardErrorResponses(400, 401)
  async previewRule(@Body() body: ParseDslDto): Promise<unknown> {
    return this.alertsService.previewRule({ dslText: body.dslText });
  }

  @Post('incidents/:id/resolve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Resolve alert incident' })
  @ApiOkResponse({
    description: 'Alert incident resolved.',
    type: OkResponseDto,
  })
  @ApiStandardErrorResponses(400, 401)
  async resolveIncident(@Param('id') id: string): Promise<{ ok: boolean }> {
    return this.alertsService.resolveIncident(id);
  }

  @Post('incidents/:id/ack')
  @HttpCode(200)
  @ApiOperation({ summary: 'Acknowledge alert incident' })
  @ApiOkResponse({
    description: 'Alert incident acknowledged.',
    type: OkResponseDto,
  })
  @ApiStandardErrorResponses(400, 401)
  async acknowledgeIncident(
    @Param('id') id: string,
    @Body() body: AckIncidentDto,
  ): Promise<{ ok: boolean }> {
    return this.alertsService.acknowledgeIncident(id, body);
  }

  @Post('incidents/:id/silence')
  @HttpCode(200)
  @ApiOperation({ summary: 'Create silence from incident' })
  @ApiOkResponse({
    description: 'Alert incident silenced.',
    type: AlertSilenceWriteResponseDto,
  })
  @ApiStandardErrorResponses(400, 401)
  async silenceIncident(
    @Param('id') id: string,
    @Body() body: CreateSilenceDto,
  ): Promise<{ id: string; endsAt: string }> {
    return this.alertsService.silenceIncident(id, body.durationMinutes);
  }

  @Get('silences')
  @ApiOperation({ summary: 'List alert silences' })
  @ApiOkResponse({
    description: 'Alert silences returned.',
    type: AlertSilenceListDto,
  })
  @ApiStandardErrorResponses(401)
  async listSilences(): Promise<{ items: unknown[]; count: number }> {
    const items = await this.alertsService.listSilences();
    return { items, count: items.length };
  }

  @Post('silences')
  @HttpCode(200)
  @ApiOperation({ summary: 'Create alert silence' })
  @ApiOkResponse({
    description: 'Alert silence created.',
    type: AlertSilenceWriteResponseDto,
  })
  @ApiStandardErrorResponses(400, 401)
  async createSilence(
    @Body() body: CreateSilenceDto,
  ): Promise<{ id: string; endsAt: string }> {
    return this.alertsService.createSilence(body);
  }

  @Post('silences/:id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel alert silence' })
  @ApiOkResponse({
    description: 'Alert silence cancelled.',
    type: OkResponseDto,
  })
  @ApiStandardErrorResponses(400, 401)
  async cancelSilence(@Param('id') id: string): Promise<{ ok: boolean }> {
    return this.alertsService.cancelSilence(id);
  }
}
