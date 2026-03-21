import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
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
import { and, eq, gt, isNull } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import * as schema from '../database/schema';
import {
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';
import { DatabaseService } from '../database/database.service';
import { MonitoringService } from '../monitoring/monitoring.service';
import { ApiStandardErrorResponses } from '../shared/error-response';
import {
  createOpaqueToken,
  extractBearerToken,
  hashToken,
} from '../shared/token.util';

class EnrollDto {
  @ApiProperty({ example: 'logovisor-bootstrap-token' })
  @IsString()
  @IsNotEmpty()
  bootstrapToken: string;

  @ApiProperty({ example: 'docker-agent' })
  @IsString()
  @IsNotEmpty()
  hostId: string;

  @ApiProperty({ example: 'install-123' })
  @IsString()
  @IsNotEmpty()
  installationId: string;

  @ApiProperty({ example: 'hackathon-host-1' })
  @IsString()
  @IsNotEmpty()
  hostname: string;

  @ApiProperty({ example: 'linux' })
  @IsString()
  @IsNotEmpty()
  os: string;
}

class HeartbeatDto {
  @ApiPropertyOptional({ example: 'healthy' })
  @IsOptional()
  @IsString()
  health?: string;

  @ApiPropertyOptional({ example: 'hackathonrnd-1-19.aeza.network' })
  @IsOptional()
  @IsString()
  hostname?: string;

  @ApiPropertyOptional({ example: 3 })
  @IsOptional()
  @IsNumber()
  queueDepth?: number;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    example: { sentBatches: 12 },
  })
  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    example: { cpuPercent: 12.5, memoryMb: 128 },
  })
  @IsOptional()
  @IsObject()
  system?: Record<string, unknown>;
}

class EnrollResponseDto {
  @ApiProperty({ example: 'f2952c1b-bf34-4c8e-a729-df2ae254880e' })
  agentId: string;

  @ApiProperty({ example: 'agt_live_token' })
  agentToken: string;
}

class StatusResponseDto {
  @ApiProperty({ example: 'ok' })
  status: string;
}

@Controller('agents')
@ApiTags('agents')
export class AgentsController {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly monitoringService: MonitoringService,
  ) {}

  @Post('enroll')
  @HttpCode(200)
  @ApiOperation({ summary: 'Enroll agent using bootstrap token' })
  @ApiBody({ type: EnrollDto })
  @ApiStandardErrorResponses(400, 401)
  @ApiOkResponse({
    description: 'Agent enrolled successfully.',
    type: EnrollResponseDto,
  })
  async enroll(@Body() enrollDto: EnrollDto): Promise<{
    agentId: string;
    agentToken: string;
  }> {
    await this.databaseService.ensureInitialized();

    return this.databaseService.db.transaction(async (tx) => {
      const [tokenRecord] = await tx
        .select()
        .from(schema.enrollmentTokens)
        .where(
          and(
            eq(
              schema.enrollmentTokens.tokenHash,
              hashToken(enrollDto.bootstrapToken),
            ),
            isNull(schema.enrollmentTokens.usedAt),
            isNull(schema.enrollmentTokens.revokedAt),
            gt(schema.enrollmentTokens.expiresAt, new Date()),
          ),
        )
        .limit(1);

      if (!tokenRecord) {
        this.monitoringService.recordEnroll(false);
        throw new UnauthorizedException('invalid or expired enrollment token');
      }

      const [existingAgent] = await tx
        .select()
        .from(schema.agents)
        .where(eq(schema.agents.installationId, enrollDto.installationId))
        .limit(1);

      const agentId = existingAgent?.id ?? randomUUID();

      if (!existingAgent) {
        await tx.insert(schema.agents).values({
          id: agentId,
          hostId: enrollDto.hostId,
          installationId: enrollDto.installationId,
          hostname: enrollDto.hostname,
          os: enrollDto.os,
          lastSeenAt: new Date(),
        });
      }

      const agentToken = createOpaqueToken('agt');
      await tx.insert(schema.agentTokens).values({
        id: randomUUID(),
        agentId,
        tokenHash: hashToken(agentToken),
        tokenPrefix: agentToken.slice(0, 12),
      });

      await tx
        .update(schema.enrollmentTokens)
        .set({ usedAt: new Date() })
        .where(eq(schema.enrollmentTokens.id, tokenRecord.id));

      this.monitoringService.recordEnroll(true);

      return {
        agentId,
        agentToken,
      };
    });
  }

  @Post('heartbeat')
  @HttpCode(200)
  @ApiBearerAuth('agent-bearer')
  @ApiHeader({
    name: 'Authorization',
    required: true,
    description: 'Bearer runtime token issued during enrollment.',
  })
  @ApiOperation({ summary: 'Submit agent heartbeat' })
  @ApiBody({ type: HeartbeatDto })
  @ApiStandardErrorResponses(400, 401)
  @ApiOkResponse({
    description: 'Heartbeat accepted.',
    type: StatusResponseDto,
  })
  async heartbeat(
    @Headers('authorization') authorizationHeader: string | undefined,
    @Body() heartbeatDto: HeartbeatDto,
  ): Promise<{ status: string }> {
    await this.databaseService.ensureInitialized();

    const token = extractBearerToken(authorizationHeader);
    if (!token) {
      this.monitoringService.recordHeartbeat(false);
      throw new UnauthorizedException('missing bearer token');
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
      this.monitoringService.recordHeartbeat(false);
      throw new UnauthorizedException('invalid agent token');
    }

    if (heartbeatDto.queueDepth !== undefined && heartbeatDto.queueDepth < 0) {
      this.monitoringService.recordHeartbeat(false);
      throw new BadRequestException('queueDepth must be greater than or equal to 0');
    }

    await this.databaseService.db.insert(schema.heartbeatHistory).values({
      id: randomUUID(),
      agentId: tokenRecord.agentId,
      payload: {
        health: heartbeatDto.health ?? 'healthy',
        queueDepth: heartbeatDto.queueDepth ?? 0,
        payload: heartbeatDto.payload ?? null,
        system: heartbeatDto.system ?? null,
      },
    });

    await this.databaseService.db
      .update(schema.agents)
      .set({
        lastSeenAt: new Date(),
        ...(heartbeatDto.hostname ? { hostname: heartbeatDto.hostname } : {}),
      })
      .where(eq(schema.agents.id, tokenRecord.agentId));

    this.monitoringService.recordHeartbeat(true);

    return { status: 'ok' };
  }
}
