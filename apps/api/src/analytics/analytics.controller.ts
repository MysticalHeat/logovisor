import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { OperatorAuthGuard } from '../auth/operator-auth.guard';
import { ApiStandardErrorResponses } from '../shared/error-response';
import { AnalyticsService } from './analytics.service';
import type {
  LogsAnalyticsResult,
  OverviewAnalyticsResult,
  SystemAnalyticsResult,
} from './analytics.service';

class AnalyticsQueryDto {
  @ApiPropertyOptional({ enum: ['1h', '6h', '24h', '7d'], example: '24h' })
  @IsOptional()
  @IsIn(['1h', '6h', '24h', '7d'])
  range?: '1h' | '6h' | '24h' | '7d';

  @ApiPropertyOptional({ example: 'docker-agent' })
  @IsOptional()
  @IsString()
  hostId?: string;

  @ApiPropertyOptional({ example: 'f2952c1b-bf34-4c8e-a729-df2ae254880e' })
  @IsOptional()
  @IsString()
  agentId?: string;
}

class AnalyticsFiltersDto {
  @ApiPropertyOptional({ example: 'docker-agent' })
  hostId?: string;

  @ApiPropertyOptional({ example: 'f2952c1b-bf34-4c8e-a729-df2ae254880e' })
  agentId?: string;
}

class AnalyticsOverviewTotalsDto {
  @ApiProperty({ example: 3 })
  matchedAgents: number;

  @ApiProperty({ example: 2 })
  activeAgents: number;

  @ApiProperty({ example: 3 })
  matchedHosts: number;

  @ApiProperty({ example: 1250 })
  totalLogs: number;

  @ApiProperty({ example: 42 })
  errorLogs: number;

  @ApiProperty({ example: 88 })
  warnLogs: number;

  @ApiProperty({ example: 240 })
  heartbeatSamples: number;

  @ApiProperty({ example: 5 })
  unhealthyHeartbeats: number;

  @ApiProperty({ example: 18.2 })
  avgCpuPercent: number;

  @ApiProperty({ example: 62.4 })
  avgMemoryUsedPercent: number;

  @ApiProperty({ example: 54.9 })
  avgDiskUsedPercent: number;
}

class AnalyticsOverviewResponseDto {
  @ApiProperty({ example: '2026-03-22T12:00:00.000Z' })
  generatedAt: string;

  @ApiProperty({ enum: ['1h', '6h', '24h', '7d'], example: '24h' })
  range: string;

  @ApiProperty({ example: '2026-03-21T12:00:00.000Z' })
  startAt: string;

  @ApiProperty({ example: '2026-03-22T12:00:00.000Z' })
  endAt: string;

  @ApiProperty({ type: AnalyticsFiltersDto })
  filters: AnalyticsFiltersDto;

  @ApiProperty({ type: AnalyticsOverviewTotalsDto })
  totals: AnalyticsOverviewTotalsDto;
}

class LogsVolumePointDto {
  @ApiProperty({ example: '2026-03-22T11:00:00.000Z' })
  bucketStart: string;

  @ApiProperty({ example: 140 })
  totalLogs: number;

  @ApiProperty({ example: 8 })
  errorLogs: number;

  @ApiProperty({ example: 13 })
  warnLogs: number;
}

class AnalyticsBreakdownItemDto {
  @ApiProperty({ example: 'error' })
  key: string;

  @ApiProperty({ example: 42 })
  count: number;
}

class AnalyticsTopHostDto {
  @ApiProperty({ example: 'docker-agent' })
  hostId: string;

  @ApiProperty({ example: 300 })
  count: number;
}

class ErrorHeatmapPointDto {
  @ApiProperty({ example: '2026-03-22' })
  day: string;

  @ApiProperty({ example: 14 })
  hour: number;

  @ApiProperty({ example: 27 })
  errorCount: number;
}

class TopErrorMessageDto {
  @ApiProperty({ example: 'database timeout while ingesting logs' })
  message: string;

  @ApiProperty({ example: 18 })
  count: number;

  @ApiProperty({ example: '2026-03-22 13:45:10' })
  lastSeenAt: string;
}

class LogsComparisonDto {
  @ApiProperty({ example: 1250 })
  currentTotalLogs: number;

  @ApiProperty({ example: 980 })
  previousTotalLogs: number;

  @ApiProperty({ example: 42 })
  currentErrorLogs: number;

  @ApiProperty({ example: 31 })
  previousErrorLogs: number;
}

class VolumeComparisonPointDto {
  @ApiProperty({ example: '2026-03-22T11:00:00.000Z' })
  bucketStart: string;

  @ApiProperty({ example: 140 })
  currentTotalLogs: number;

  @ApiProperty({ example: 120 })
  previousTotalLogs: number;
}

class LogsAnalyticsResponseDto {
  @ApiProperty({ example: '2026-03-22T12:00:00.000Z' })
  generatedAt: string;

  @ApiProperty({ enum: ['1h', '6h', '24h', '7d'], example: '24h' })
  range: string;

  @ApiProperty({ example: '2026-03-21T12:00:00.000Z' })
  startAt: string;

  @ApiProperty({ example: '2026-03-22T12:00:00.000Z' })
  endAt: string;

  @ApiProperty({ example: 60 })
  bucketMinutes: number;

  @ApiProperty({ example: 1250 })
  totalLogs: number;

  @ApiProperty({ type: [LogsVolumePointDto] })
  volume: LogsVolumePointDto[];

  @ApiProperty({ type: [ErrorHeatmapPointDto] })
  errorHeatmap: ErrorHeatmapPointDto[];

  @ApiProperty({ type: [TopErrorMessageDto] })
  topErrorMessages: TopErrorMessageDto[];

  @ApiProperty({ type: LogsComparisonDto })
  comparison: LogsComparisonDto;

  @ApiProperty({ type: [VolumeComparisonPointDto] })
  volumeComparison: VolumeComparisonPointDto[];

  @ApiProperty({ type: [AnalyticsBreakdownItemDto] })
  byLevel: AnalyticsBreakdownItemDto[];

  @ApiProperty({ type: [AnalyticsBreakdownItemDto] })
  bySource: AnalyticsBreakdownItemDto[];

  @ApiProperty({ type: [AnalyticsTopHostDto] })
  topHosts: AnalyticsTopHostDto[];

  @ApiProperty({ type: [AnalyticsTopHostDto] })
  topErrorHosts: AnalyticsTopHostDto[];
}

class SystemSummaryDto {
  @ApiProperty({ example: 240 })
  sampleCount: number;

  @ApiProperty({ example: 5 })
  unhealthySamples: number;

  @ApiProperty({ example: 18.2 })
  avgCpuPercent: number;

  @ApiProperty({ example: 91.5 })
  maxCpuPercent: number;

  @ApiProperty({ example: 62.4 })
  avgMemoryUsedPercent: number;

  @ApiProperty({ example: 88.7 })
  maxMemoryUsedPercent: number;

  @ApiProperty({ example: 54.9 })
  avgDiskUsedPercent: number;

  @ApiProperty({ example: 81.2 })
  maxDiskUsedPercent: number;
}

class SystemTimelinePointDto {
  @ApiProperty({ example: '2026-03-22T11:00:00.000Z' })
  bucketStart: string;

  @ApiProperty({ example: 12 })
  samples: number;

  @ApiProperty({ example: 17.2 })
  avgCpuPercent: number;

  @ApiProperty({ example: 64.1 })
  avgMemoryUsedPercent: number;

  @ApiProperty({ example: 52.8 })
  avgDiskUsedPercent: number;
}

class LatestHostSystemSampleDto {
  @ApiProperty({ example: 'f2952c1b-bf34-4c8e-a729-df2ae254880e' })
  agentId: string;

  @ApiProperty({ example: 'docker-agent' })
  hostId: string;

  @ApiProperty({ example: 'hackathon-host-1' })
  hostname: string;

  @ApiProperty({ example: '2026-03-22T11:58:00.000Z' })
  receivedAt: string;

  @ApiProperty({ example: 'healthy' })
  health: string;

  @ApiProperty({ example: 3 })
  queueDepth: number;

  @ApiProperty({ example: 12.8 })
  cpuPercent: number;

  @ApiProperty({ example: 64.4 })
  memoryUsedPercent: number;

  @ApiProperty({ example: 55.2 })
  diskUsedPercent: number;

  @ApiProperty({ example: 0.42 })
  load1: number;
}

class SystemAnalyticsResponseDto {
  @ApiProperty({ example: '2026-03-22T12:00:00.000Z' })
  generatedAt: string;

  @ApiProperty({ enum: ['1h', '6h', '24h', '7d'], example: '24h' })
  range: string;

  @ApiProperty({ example: '2026-03-21T12:00:00.000Z' })
  startAt: string;

  @ApiProperty({ example: '2026-03-22T12:00:00.000Z' })
  endAt: string;

  @ApiProperty({ example: 60 })
  bucketMinutes: number;

  @ApiProperty({ type: SystemSummaryDto })
  summary: SystemSummaryDto;

  @ApiProperty({ type: [SystemTimelinePointDto] })
  timeline: SystemTimelinePointDto[];

  @ApiProperty({ type: [LatestHostSystemSampleDto] })
  latestByHost: LatestHostSystemSampleDto[];
}

@Controller('admin/analytics')
@ApiTags('analytics')
@ApiCookieAuth('operator-session')
@UseGuards(OperatorAuthGuard)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('overview')
  @ApiOperation({
    summary: 'Get combined fleet, log, and heartbeat analytics overview',
  })
  @ApiOkResponse({ type: AnalyticsOverviewResponseDto })
  @ApiStandardErrorResponses(401)
  async getOverview(
    @Query() query: AnalyticsQueryDto,
  ): Promise<OverviewAnalyticsResult> {
    const filters = this.analyticsService.resolveFilters(
      query.range ?? '24h',
      query.hostId,
      query.agentId,
    );
    return this.analyticsService.getOverview(filters);
  }

  @Get('logs')
  @ApiOperation({ summary: 'Get aggregated log analytics from ClickHouse' })
  @ApiOkResponse({ type: LogsAnalyticsResponseDto })
  @ApiStandardErrorResponses(401)
  async getLogs(
    @Query() query: AnalyticsQueryDto,
  ): Promise<LogsAnalyticsResult> {
    const filters = this.analyticsService.resolveFilters(
      query.range ?? '24h',
      query.hostId,
      query.agentId,
    );
    return this.analyticsService.getLogs(filters);
  }

  @Get('system')
  @ApiOperation({
    summary: 'Get aggregated system analytics from heartbeat history',
  })
  @ApiOkResponse({ type: SystemAnalyticsResponseDto })
  @ApiStandardErrorResponses(401)
  async getSystem(
    @Query() query: AnalyticsQueryDto,
  ): Promise<SystemAnalyticsResult> {
    const filters = this.analyticsService.resolveFilters(
      query.range ?? '24h',
      query.hostId,
      query.agentId,
    );
    return this.analyticsService.getSystem(filters);
  }
}
