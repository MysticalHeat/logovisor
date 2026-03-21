import {
  BadRequestException,
  Body,
  HttpCode,
  Headers,
  Controller,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { and, eq, isNull } from 'drizzle-orm';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import * as schema from '../database/schema';
import { ClickhouseService } from '../clickhouse/clickhouse.service';
import { DatabaseService } from '../database/database.service';
import { MonitoringService } from '../monitoring/monitoring.service';
import { ApiStandardErrorResponses } from '../shared/error-response';
import { extractBearerToken, hashToken } from '../shared/token.util';
import { LogStreamService } from '../admin/log-stream.service';

class IngestEventDto {
  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsNumber()
  schema_version?: number;

  @ApiPropertyOptional({ example: 'agent-123' })
  @IsOptional()
  @IsString()
  agent_id?: string;

  @ApiPropertyOptional({ example: 'docker-agent' })
  @IsOptional()
  @IsString()
  host_id?: string;

  @ApiPropertyOptional({ example: 'file' })
  @IsOptional()
  @IsString()
  source_type?: string;

  @ApiPropertyOptional({ example: 'error' })
  @IsOptional()
  @IsString()
  level?: string;

  @ApiProperty({ example: 'hello from logovisor' })
  @IsString()
  @IsNotEmpty()
  message: string;

  @ApiPropertyOptional({ example: 'evt_123' })
  @IsOptional()
  @IsString()
  event_id?: string;

  @ApiPropertyOptional({ example: '2026-03-21T10:00:00.000Z' })
  @IsOptional()
  @IsString()
  timestamp?: string;

  @ApiPropertyOptional({ example: '2026-03-21T10:00:01.000Z' })
  @IsOptional()
  @IsString()
  observed_at?: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    example: { path: '/tmp/logovisor-agent.log', offset: 42 },
  })
  @IsOptional()
  @IsObject()
  source?: Record<string, unknown>;
}

class LogIngestDto {
  @ApiProperty({ example: 'batch-123' })
  @IsString()
  @IsNotEmpty()
  batchId: string;

  @ApiProperty({ type: [IngestEventDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => IngestEventDto)
  events: IngestEventDto[];
}

class LogIngestResponseDto {
  @ApiProperty({ example: 'batch-123' })
  batchId: string;

  @ApiProperty({ example: true })
  accepted: boolean;

  @ApiProperty({ example: 2 })
  receivedEvents: number;
}

@Controller('ingest')
@ApiTags('ingest')
export class IngestController {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly clickhouseService: ClickhouseService,
    private readonly monitoringService: MonitoringService,
    private readonly logStreamService: LogStreamService,
  ) {}

  @Post('logs')
  @HttpCode(200)
  @ApiBearerAuth('agent-bearer')
  @ApiHeader({
    name: 'Authorization',
    required: true,
    description: 'Bearer runtime token issued during enrollment.',
  })
  @ApiHeader({
    name: 'Content-Encoding',
    required: false,
    description: 'Batch encoding. Supported values: gzip, identity.',
  })
  @ApiOperation({ summary: 'Ingest log batch from agent' })
  @ApiBody({ type: LogIngestDto })
  @ApiStandardErrorResponses(400, 401)
  @ApiOkResponse({
    description: 'Log batch accepted.',
    type: LogIngestResponseDto,
  })
  async ingest(
    @Headers('authorization') authorizationHeader: string | undefined,
    @Headers('content-encoding') contentEncoding: string | undefined,
    @Body() ingestDto: LogIngestDto,
  ): Promise<{ batchId: string; accepted: boolean; receivedEvents: number }> {
    await this.databaseService.ensureInitialized();

    const token = extractBearerToken(authorizationHeader);
    if (!token) {
      throw new UnauthorizedException('missing bearer token');
    }

    if (!Array.isArray(ingestDto.events) || ingestDto.events.length === 0) {
      throw new BadRequestException('Invalid ingest payload');
    }

    if (
      contentEncoding &&
      contentEncoding !== 'gzip' &&
      contentEncoding !== 'identity'
    ) {
      throw new BadRequestException(
        `unsupported content encoding: ${contentEncoding}`,
      );
    }

    const [tokenRecord] = await this.databaseService.db
      .select()
      .from(schema.agentTokens)
      .where(
        and(
          eq(schema.agentTokens.tokenHash, hashToken(token)),
          isNull(schema.agentTokens.revokedAt),
        ),
      )
      .limit(1);

    if (!tokenRecord) {
      throw new UnauthorizedException('Invalid agent token');
    }

    const normalizedEvents = ingestDto.events.map((event) => ({
      ...event,
      agentId: tokenRecord.agentId,
    }));

    await this.clickhouseService.writeLogs(normalizedEvents);
    this.logStreamService.publishBatch(normalizedEvents);

    this.monitoringService.recordIngestBatch(ingestDto.events.length);

    return {
      batchId: ingestDto.batchId,
      accepted: true,
      receivedEvents: ingestDto.events.length,
    };
  }
}
