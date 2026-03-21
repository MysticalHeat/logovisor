import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
  Body,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { and, desc, eq, sql } from 'drizzle-orm';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { randomUUID } from 'node:crypto';
import { OperatorAuthGuard } from '../auth/operator-auth.guard';
import { ClickhouseService } from '../clickhouse/clickhouse.service';
import { DatabaseService } from '../database/database.service';
import { MonitoringService } from '../monitoring/monitoring.service';
import { ApiStandardErrorResponses } from '../shared/error-response';
import { createOpaqueToken, hashToken } from '../shared/token.util';
import * as schema from '../database/schema';

class AgentListQueryDto {
  @ApiPropertyOptional({ example: 'docker-agent' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ example: 50, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({ example: 0, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  @ApiPropertyOptional({ example: 'online' })
  @IsOptional()
  @IsString()
  status?: string;
}

class LogSearchQueryDto {
  @ApiPropertyOptional({ example: 'docker-agent' })
  @IsOptional()
  @IsString()
  agentId?: string;

  @ApiPropertyOptional({ example: 'docker-agent' })
  @IsOptional()
  @IsString()
  hostId?: string;

  @ApiPropertyOptional({ example: 'file' })
  @IsOptional()
  @IsString()
  sourceType?: string;

  @ApiPropertyOptional({ example: 'error' })
  @IsOptional()
  @IsString()
  level?: string;

  @ApiPropertyOptional({ example: 'error' })
  @IsOptional()
  @IsString()
  query?: string;

  @ApiPropertyOptional({ example: '2026-03-21T00:00:00.000Z' })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-03-22T00:00:00.000Z' })
  @IsOptional()
  @IsString()
  to?: string;

  @ApiPropertyOptional({ example: 100, minimum: 1, maximum: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  @ApiPropertyOptional({ example: '2026-03-21T10:35:03.000Z' })
  @IsOptional()
  @IsString()
  beforeTimestamp?: string;

  @ApiPropertyOptional({ example: 'evt_123' })
  @IsOptional()
  @IsString()
  beforeEventId?: string;
}

class EnrollmentTokenCreateDto {
  @ApiPropertyOptional({ example: 'temporary bootstrap token' })
  @IsOptional()
  @IsString()
  label?: string;

  @ApiPropertyOptional({ example: 60, minimum: 1, maximum: 10080 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10080)
  ttlMinutes?: number;
}

class AgentSummaryDto {
  @ApiProperty({ example: 'f2952c1b-bf34-4c8e-a729-df2ae254880e' })
  id: string;

  @ApiProperty({ example: 'docker-agent' })
  hostId: string;

  @ApiProperty({ example: 'install-123' })
  installationId: string;

  @ApiProperty({ example: 'hackathon-host-1' })
  hostname: string;

  @ApiProperty({ example: 'linux' })
  os: string;

  @ApiProperty({ example: '2026-03-21T10:35:03.000Z' })
  lastSeenAt: string;

  @ApiProperty({ example: '2026-03-21T10:00:00.000Z' })
  createdAt: string;

  @ApiProperty({ example: 'online' })
  status: string;
}

class AgentsListResponseDto {
  @ApiProperty({ type: [AgentSummaryDto] })
  items: AgentSummaryDto[];

  @ApiProperty({ example: 1 })
  count: number;
}

class HostSystemMetricsDto {
  @ApiProperty({ example: 12.5 })
  cpuPercent: number;

  @ApiProperty({ example: 0.42 })
  load1: number;

  @ApiProperty({ example: 0.31 })
  load5: number;

  @ApiProperty({ example: 0.18 })
  load15: number;

  @ApiProperty({ example: 17179869184 })
  memoryTotalBytes: number;

  @ApiProperty({ example: 8589934592 })
  memoryAvailableBytes: number;

  @ApiProperty({ example: 8589934592 })
  memoryUsedBytes: number;

  @ApiProperty({ example: 2147483648 })
  swapTotalBytes: number;

  @ApiProperty({ example: 268435456 })
  swapUsedBytes: number;

  @ApiProperty({ example: 274877906944 })
  diskTotalBytes: number;

  @ApiProperty({ example: 137438953472 })
  diskUsedBytes: number;

  @ApiProperty({ example: 137438953472 })
  diskFreeBytes: number;

  @ApiProperty({ example: 123456789 })
  networkRxBytes: number;

  @ApiProperty({ example: 987654321 })
  networkTxBytes: number;

  @ApiProperty({ example: 86400.5 })
  uptimeSeconds: number;
}

class HeartbeatSnapshotDto {
  @ApiProperty({ example: '2026-03-21T10:35:03.000Z' })
  receivedAt: string;

  @ApiProperty({ example: 'healthy' })
  health: string;

  @ApiProperty({ example: 4 })
  queueDepth: number;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: { sentBatches: 10 },
  })
  payload: Record<string, unknown> | null;

  @ApiPropertyOptional({ type: HostSystemMetricsDto })
  system: HostSystemMetricsDto | null;
}

class AgentDetailDto extends AgentSummaryDto {
  @ApiPropertyOptional({ type: HeartbeatSnapshotDto })
  latestHeartbeat?: HeartbeatSnapshotDto;

  @ApiProperty({ type: [HeartbeatSnapshotDto] })
  recentHeartbeats: HeartbeatSnapshotDto[];
}

class LogEventDto {
  @ApiProperty({ example: '2026-03-21T10:35:03.000Z' })
  timestamp: string;

  @ApiProperty({ example: '2026-03-21T10:35:04.000Z' })
  observedAt: string;

  @ApiProperty({ example: 'evt_123' })
  eventId: string;

  @ApiProperty({ example: 'agent-123' })
  agentId: string;

  @ApiProperty({ example: 'docker-agent' })
  hostId: string;

  @ApiProperty({ example: 'file' })
  sourceType: string;

  @ApiPropertyOptional({ example: 'error' })
  level?: string;

  @ApiProperty({ example: 'hello from logovisor' })
  message: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: { path: '/tmp/logovisor-agent.log', offset: 42 },
  })
  source: Record<string, unknown>;
}

class LogSearchResponseDto {
  @ApiProperty({ type: [LogEventDto] })
  items: LogEventDto[];

  @ApiProperty({ example: 2 })
  count: number;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    example: {
      beforeTimestamp: '2026-03-21T10:35:03.000Z',
      beforeEventId: 'evt_123',
    },
  })
  nextCursor?: Record<string, string>;
}

class AgentTokenSummaryDto {
  @ApiProperty({ example: 'f2952c1b-bf34-4c8e-a729-df2ae254880e' })
  id: string;

  @ApiProperty({ example: 'agt_abcdef1234' })
  tokenPrefix: string;

  @ApiPropertyOptional({ example: '2026-03-21T10:35:03.000Z' })
  revokedAt?: string;

  @ApiProperty({ example: '2026-03-21T10:00:00.000Z' })
  createdAt: string;
}

class AgentTokenListResponseDto {
  @ApiProperty({ type: [AgentTokenSummaryDto] })
  items: AgentTokenSummaryDto[];

  @ApiProperty({ example: 1 })
  count: number;
}

class EnrollmentTokenSummaryDto {
  @ApiProperty({ example: 'f2952c1b-bf34-4c8e-a729-df2ae254880e' })
  id: string;

  @ApiPropertyOptional({ example: 'temporary bootstrap token' })
  label?: string;

  @ApiPropertyOptional({ example: 'enr_abcdef1234' })
  tokenPrefix?: string;

  @ApiProperty({ example: '2026-03-21T12:00:00.000Z' })
  expiresAt: string;

  @ApiPropertyOptional({ example: '2026-03-21T10:35:03.000Z' })
  usedAt?: string;

  @ApiPropertyOptional({ example: '2026-03-21T10:40:03.000Z' })
  revokedAt?: string;

  @ApiProperty({ example: '2026-03-21T10:00:00.000Z' })
  createdAt: string;
}

class EnrollmentTokenListResponseDto {
  @ApiProperty({ type: [EnrollmentTokenSummaryDto] })
  items: EnrollmentTokenSummaryDto[];

  @ApiProperty({ example: 1 })
  count: number;
}

class EnrollmentTokenCreateResponseDto extends EnrollmentTokenSummaryDto {
  @ApiProperty({ example: 'enr_abcdef1234567890' })
  token: string;
}

@Controller('admin')
@ApiTags('admin')
@ApiCookieAuth('operator-session')
@UseGuards(OperatorAuthGuard)
export class AdminController {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly clickhouseService: ClickhouseService,
    private readonly monitoringService: MonitoringService,
  ) {}

  @Get('agents')
  @ApiOperation({ summary: 'List enrolled agents with current status' })
  @ApiOkResponse({ type: AgentsListResponseDto })
  @ApiStandardErrorResponses(401)
  async listAgents(
    @Query() query: AgentListQueryDto,
  ): Promise<AgentsListResponseDto> {
    await this.databaseService.ensureInitialized();

    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;
    const filters = [];
    if (query.search) {
      const pattern = `%${query.search}%`;
      filters.push(
        sql`(${schema.agents.hostId} ILIKE ${pattern} OR ${schema.agents.hostname} ILIKE ${pattern} OR ${schema.agents.installationId} ILIKE ${pattern})`,
      );
    }
    if (query.status === 'online') {
      filters.push(
        sql`${schema.agents.lastSeenAt} >= NOW() - INTERVAL '5 minutes'`,
      );
    }
    if (query.status === 'offline') {
      filters.push(
        sql`${schema.agents.lastSeenAt} < NOW() - INTERVAL '5 minutes'`,
      );
    }

    const rows = await this.databaseService.db
      .select()
      .from(schema.agents)
      .where(filters.length > 0 ? and(...filters) : undefined)
      .orderBy(desc(schema.agents.lastSeenAt))
      .offset(offset)
      .limit(limit);

    const items = rows.map((agent) => toAgentSummary(agent));
    return { items, count: items.length };
  }

  @Get('agents/:id')
  @ApiOperation({ summary: 'Get agent details and recent heartbeats' })
  @ApiOkResponse({ type: AgentDetailDto })
  @ApiStandardErrorResponses(401, 404)
  async getAgent(@Param('id') id: string): Promise<AgentDetailDto> {
    await this.databaseService.ensureInitialized();

    const [agent] = await this.databaseService.db
      .select()
      .from(schema.agents)
      .where(eq(schema.agents.id, id))
      .limit(1);

    if (!agent) {
      throw new NotFoundException(`agent not found: ${id}`);
    }

    const heartbeats = await this.databaseService.db
      .select()
      .from(schema.heartbeatHistory)
      .where(eq(schema.heartbeatHistory.agentId, id))
      .orderBy(desc(schema.heartbeatHistory.receivedAt))
      .limit(10);

    const recentHeartbeats = heartbeats.map((heartbeat) =>
      toHeartbeatSnapshot(heartbeat),
    );

    return {
      ...toAgentSummary(agent),
      latestHeartbeat: recentHeartbeats[0],
      recentHeartbeats,
    };
  }

  @Get('agents/:id/tokens')
  @ApiOperation({ summary: 'List runtime agent tokens' })
  @ApiOkResponse({ type: AgentTokenListResponseDto })
  @ApiStandardErrorResponses(401)
  async listAgentTokens(
    @Param('id') id: string,
  ): Promise<AgentTokenListResponseDto> {
    await this.databaseService.ensureInitialized();

    const rows = await this.databaseService.db
      .select()
      .from(schema.agentTokens)
      .where(eq(schema.agentTokens.agentId, id))
      .orderBy(desc(schema.agentTokens.createdAt));

    const items = rows.map((row) => ({
      id: row.id,
      tokenPrefix: row.tokenPrefix,
      revokedAt: row.revokedAt?.toISOString(),
      createdAt: row.createdAt.toISOString(),
    }));

    return { items, count: items.length };
  }

  @Post('agents/:id/tokens/:tokenId/revoke')
  @ApiOperation({ summary: 'Revoke runtime agent token' })
  @ApiOkResponse({ type: AgentTokenSummaryDto })
  @ApiStandardErrorResponses(401, 404)
  async revokeAgentToken(
    @Param('id') id: string,
    @Param('tokenId') tokenId: string,
  ): Promise<AgentTokenSummaryDto> {
    await this.databaseService.ensureInitialized();

    const [row] = await this.databaseService.db
      .select()
      .from(schema.agentTokens)
      .where(
        and(
          eq(schema.agentTokens.id, tokenId),
          eq(schema.agentTokens.agentId, id),
        ),
      )
      .limit(1);

    if (!row) {
      throw new NotFoundException(`agent token not found: ${tokenId}`);
    }

    await this.databaseService.db
      .update(schema.agentTokens)
      .set({ revokedAt: new Date() })
      .where(eq(schema.agentTokens.id, tokenId));

    return {
      id: row.id,
      tokenPrefix: row.tokenPrefix,
      revokedAt: new Date().toISOString(),
      createdAt: row.createdAt.toISOString(),
    };
  }

  @Get('enrollment-tokens')
  @ApiOperation({ summary: 'List enrollment tokens' })
  @ApiOkResponse({ type: EnrollmentTokenListResponseDto })
  @ApiStandardErrorResponses(401)
  async listEnrollmentTokens(): Promise<EnrollmentTokenListResponseDto> {
    await this.databaseService.ensureInitialized();

    const rows = await this.databaseService.db
      .select()
      .from(schema.enrollmentTokens)
      .orderBy(desc(schema.enrollmentTokens.createdAt));

    const items = rows.map((row) => ({
      id: row.id,
      label: row.label ?? undefined,
      tokenPrefix: row.tokenPrefix ?? undefined,
      expiresAt: row.expiresAt.toISOString(),
      usedAt: row.usedAt?.toISOString(),
      revokedAt: row.revokedAt?.toISOString(),
      createdAt: row.createdAt.toISOString(),
    }));

    return { items, count: items.length };
  }

  @Post('enrollment-tokens')
  @ApiOperation({ summary: 'Create single-use enrollment token' })
  @ApiOkResponse({ type: EnrollmentTokenCreateResponseDto })
  @ApiStandardErrorResponses(400, 401)
  async createEnrollmentToken(
    @Body() body: EnrollmentTokenCreateDto,
  ): Promise<EnrollmentTokenCreateResponseDto> {
    await this.databaseService.ensureInitialized();

    const ttlMinutes = body.ttlMinutes ?? 60;
    const token = createOpaqueToken('enr');
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);
    const id = randomUUID();

    await this.databaseService.db.insert(schema.enrollmentTokens).values({
      id,
      tokenHash: hashToken(token),
      tokenPrefix: token.slice(0, 12),
      label: body.label ?? null,
      expiresAt,
    });

    return {
      id,
      token,
      tokenPrefix: token.slice(0, 12),
      label: body.label ?? undefined,
      expiresAt: expiresAt.toISOString(),
      createdAt: new Date().toISOString(),
    };
  }

  @Post('enrollment-tokens/:id/revoke')
  @ApiOperation({ summary: 'Revoke enrollment token' })
  @ApiOkResponse({ type: EnrollmentTokenSummaryDto })
  @ApiStandardErrorResponses(401, 404)
  async revokeEnrollmentToken(
    @Param('id') id: string,
  ): Promise<EnrollmentTokenSummaryDto> {
    await this.databaseService.ensureInitialized();

    const [row] = await this.databaseService.db
      .select()
      .from(schema.enrollmentTokens)
      .where(eq(schema.enrollmentTokens.id, id))
      .limit(1);

    if (!row) {
      throw new NotFoundException(`enrollment token not found: ${id}`);
    }

    const revokedAt = new Date();
    await this.databaseService.db
      .update(schema.enrollmentTokens)
      .set({ revokedAt })
      .where(eq(schema.enrollmentTokens.id, id));

    return {
      id: row.id,
      label: row.label ?? undefined,
      tokenPrefix: row.tokenPrefix ?? undefined,
      expiresAt: row.expiresAt.toISOString(),
      usedAt: row.usedAt?.toISOString(),
      revokedAt: revokedAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    };
  }

  @Get('logs/search')
  @ApiOperation({ summary: 'Search ingested logs in ClickHouse' })
  @ApiOkResponse({ type: LogSearchResponseDto })
  @ApiStandardErrorResponses(400, 401)
  async searchLogs(
    @Query() query: LogSearchQueryDto,
  ): Promise<LogSearchResponseDto> {
    const from = parseIsoDate(query.from, 'from');
    const to = parseIsoDate(query.to, 'to');
    if (from && to && from > to) {
      throw new BadRequestException('from must be earlier than to');
    }

    const rows = await this.clickhouseService.searchLogs({
      agentId: query.agentId,
      hostId: query.hostId,
      sourceType: query.sourceType,
      level: query.level,
      query: query.query,
      from,
      to,
      beforeTimestamp: query.beforeTimestamp,
      beforeEventId: query.beforeEventId,
      limit: query.limit ?? 100,
    });

    this.monitoringService.recordAdminLogSearch();

    const items = rows.map((row) => ({
      timestamp: row.timestamp,
      observedAt: row.observedAt,
      eventId: row.eventId,
      agentId: row.agentId,
      hostId: row.hostId,
      sourceType: row.sourceType,
      level: row.level || undefined,
      message: row.message,
      source: row.source,
    }));

    const nextCursor =
      items.length > 0
        ? {
            beforeTimestamp: items[items.length - 1].timestamp,
            beforeEventId: items[items.length - 1].eventId,
          }
        : undefined;

    return { items, count: items.length, nextCursor };
  }
}

function toAgentSummary(
  agent: typeof schema.agents.$inferSelect,
): AgentSummaryDto {
  return {
    id: agent.id,
    hostId: agent.hostId,
    installationId: agent.installationId,
    hostname: agent.hostname,
    os: agent.os,
    lastSeenAt: agent.lastSeenAt.toISOString(),
    createdAt: agent.createdAt.toISOString(),
    status: isAgentOnline(agent.lastSeenAt) ? 'online' : 'offline',
  };
}

function toHeartbeatSnapshot(
  heartbeat: typeof schema.heartbeatHistory.$inferSelect,
): HeartbeatSnapshotDto {
  const payload = isRecord(heartbeat.payload) ? heartbeat.payload : {};
  const system = toHostSystemMetrics(payload.system);
  return {
    receivedAt: heartbeat.receivedAt.toISOString(),
    health: typeof payload.health === 'string' ? payload.health : 'unknown',
    queueDepth: typeof payload.queueDepth === 'number' ? payload.queueDepth : 0,
    payload: isRecord(payload.payload) ? payload.payload : null,
    system,
  };
}

function toHostSystemMetrics(value: unknown): HostSystemMetricsDto | null {
  if (!isRecord(value)) {
    return null;
  }

  return {
    cpuPercent: toNumber(value.cpuPercent),
    load1: toNumber(value.load1),
    load5: toNumber(value.load5),
    load15: toNumber(value.load15),
    memoryTotalBytes: toNumber(value.memoryTotalBytes),
    memoryAvailableBytes: toNumber(value.memoryAvailableBytes),
    memoryUsedBytes: toNumber(value.memoryUsedBytes),
    swapTotalBytes: toNumber(value.swapTotalBytes),
    swapUsedBytes: toNumber(value.swapUsedBytes),
    diskTotalBytes: toNumber(value.diskTotalBytes),
    diskUsedBytes: toNumber(value.diskUsedBytes),
    diskFreeBytes: toNumber(value.diskFreeBytes),
    networkRxBytes: toNumber(value.networkRxBytes),
    networkTxBytes: toNumber(value.networkTxBytes),
    uptimeSeconds: toNumber(value.uptimeSeconds),
  };
}

function toNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function isAgentOnline(lastSeenAt: Date): boolean {
  return Date.now() - lastSeenAt.getTime() <= 5 * 60 * 1000;
}

function parseIsoDate(
  value: string | undefined,
  fieldName: string,
): Date | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`${fieldName} must be a valid ISO timestamp`);
  }

  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
