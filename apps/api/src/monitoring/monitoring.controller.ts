import { Controller, Get, Header } from '@nestjs/common';
import {
  ApiExcludeController,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
} from '@nestjs/swagger';
import { ClickhouseService } from '../clickhouse/clickhouse.service';
import { DatabaseService } from '../database/database.service';
import { MonitoringService } from './monitoring.service';

class HealthResponseDto {
  @ApiProperty({ example: 'ok' })
  status: string;
}

class ReadinessResponseDto {
  @ApiProperty({ example: 'ok' })
  status: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: { postgres: 'ok', clickhouse: 'ok' },
  })
  checks: Record<string, string>;
}

@ApiExcludeController()
@Controller()
export class MonitoringController {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly clickhouseService: ClickhouseService,
    private readonly monitoringService: MonitoringService,
  ) {}

  @Get('health')
  @ApiOperation({ summary: 'Liveness probe' })
  @ApiOkResponse({ type: HealthResponseDto })
  health(): HealthResponseDto {
    return { status: 'ok' };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe' })
  @ApiOkResponse({ type: ReadinessResponseDto })
  async ready(): Promise<ReadinessResponseDto> {
    await this.databaseService.ensureInitialized();
    await this.databaseService.ping();
    await this.clickhouseService.ping();

    return {
      status: 'ok',
      checks: {
        postgres: 'ok',
        clickhouse: 'ok',
      },
    };
  }

  @Get('metrics')
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  metrics(): string {
    return this.monitoringService.renderMetrics();
  }
}
