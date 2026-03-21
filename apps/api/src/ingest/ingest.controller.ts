import {
  BadRequestException,
  Body,
  HttpCode,
  Headers,
  Controller,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
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
import { extractBearerToken, hashToken } from '../shared/token.util';

class IngestEventDto {
  @IsOptional()
  @IsNumber()
  schema_version?: number;

  @IsOptional()
  @IsString()
  agent_id?: string;

  @IsOptional()
  @IsString()
  host_id?: string;

  @IsOptional()
  @IsString()
  source_type?: string;

  @IsString()
  @IsNotEmpty()
  message: string;

  @IsOptional()
  @IsString()
  event_id?: string;

  @IsOptional()
  @IsString()
  timestamp?: string;

  @IsOptional()
  @IsString()
  observed_at?: string;

  @IsOptional()
  @IsObject()
  source?: Record<string, unknown>;
}

class LogIngestDto {
  @IsString()
  @IsNotEmpty()
  batchId: string;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => IngestEventDto)
  events: IngestEventDto[];
}

@Controller('ingest')
export class IngestController {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly clickhouseService: ClickhouseService,
  ) {}

  @Post('logs')
  @HttpCode(200)
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

    await this.clickhouseService.writeLogs(
      ingestDto.events.map((event) => ({
        ...event,
        agentId: tokenRecord.agentId,
      })),
    );

    return {
      batchId: ingestDto.batchId,
      accepted: true,
      receivedEvents: ingestDto.events.length,
    };
  }
}
