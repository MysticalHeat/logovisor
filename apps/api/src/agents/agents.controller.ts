import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
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
import {
  createOpaqueToken,
  extractBearerToken,
  hashToken,
} from '../shared/token.util';

class EnrollDto {
  @IsString()
  @IsNotEmpty()
  bootstrapToken: string;

  @IsString()
  @IsNotEmpty()
  hostId: string;

  @IsString()
  @IsNotEmpty()
  installationId: string;

  @IsString()
  @IsNotEmpty()
  hostname: string;

  @IsString()
  @IsNotEmpty()
  os: string;
}

class HeartbeatDto {
  @IsOptional()
  @IsString()
  health?: string;

  @IsOptional()
  @IsNumber()
  queueDepth?: number;

  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  system?: Record<string, unknown>;
}

@Controller('agents')
export class AgentsController {
  constructor(private readonly databaseService: DatabaseService) {}

  @Post('enroll')
  @HttpCode(200)
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
            gt(schema.enrollmentTokens.expiresAt, new Date()),
          ),
        )
        .limit(1);

      if (!tokenRecord) {
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

      return {
        agentId,
        agentToken,
      };
    });
  }

  @Post('heartbeat')
  @HttpCode(200)
  async heartbeat(
    @Headers('authorization') authorizationHeader: string | undefined,
    @Body() heartbeatDto: HeartbeatDto,
  ): Promise<{ status: string }> {
    await this.databaseService.ensureInitialized();

    const token = extractBearerToken(authorizationHeader);
    if (!token) {
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
      throw new UnauthorizedException('invalid agent token');
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
      .set({ lastSeenAt: new Date() })
      .where(eq(schema.agents.id, tokenRecord.agentId));

    return { status: 'ok' };
  }
}
