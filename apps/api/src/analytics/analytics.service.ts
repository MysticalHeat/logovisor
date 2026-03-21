import { Injectable } from '@nestjs/common';
import {
  ClickhouseService,
  quoteSqlString,
} from '../clickhouse/clickhouse.service';
import { DatabaseService } from '../database/database.service';

export type AnalyticsRange = '1h' | '6h' | '24h' | '7d';

export interface AnalyticsFilters {
  range: AnalyticsRange;
  hostId?: string;
  agentId?: string;
  startAt: Date;
  endAt: Date;
  bucketMinutes: number;
}

export interface OverviewAnalyticsResult {
  generatedAt: string;
  range: AnalyticsRange;
  startAt: string;
  endAt: string;
  filters: {
    hostId?: string;
    agentId?: string;
  };
  totals: {
    matchedAgents: number;
    activeAgents: number;
    matchedHosts: number;
    totalLogs: number;
    errorLogs: number;
    warnLogs: number;
    heartbeatSamples: number;
    unhealthyHeartbeats: number;
    avgCpuPercent: number;
    avgMemoryUsedPercent: number;
    avgDiskUsedPercent: number;
  };
}

export interface LogsAnalyticsResult {
  generatedAt: string;
  range: AnalyticsRange;
  startAt: string;
  endAt: string;
  bucketMinutes: number;
  totalLogs: number;
  volume: Array<{
    bucketStart: string;
    totalLogs: number;
    errorLogs: number;
    warnLogs: number;
  }>;
  errorHeatmap: Array<{
    day: string;
    hour: number;
    errorCount: number;
  }>;
  topErrorMessages: Array<{
    message: string;
    count: number;
    lastSeenAt: string;
  }>;
  comparison: {
    currentTotalLogs: number;
    previousTotalLogs: number;
    currentErrorLogs: number;
    previousErrorLogs: number;
  };
  volumeComparison: Array<{
    bucketStart: string;
    currentTotalLogs: number;
    previousTotalLogs: number;
  }>;
  byLevel: Array<{
    key: string;
    count: number;
  }>;
  bySource: Array<{
    key: string;
    count: number;
  }>;
  topHosts: Array<{
    hostId: string;
    count: number;
  }>;
}

export interface SystemAnalyticsResult {
  generatedAt: string;
  range: AnalyticsRange;
  startAt: string;
  endAt: string;
  bucketMinutes: number;
  summary: {
    sampleCount: number;
    unhealthySamples: number;
    avgCpuPercent: number;
    maxCpuPercent: number;
    avgMemoryUsedPercent: number;
    maxMemoryUsedPercent: number;
    avgDiskUsedPercent: number;
    maxDiskUsedPercent: number;
  };
  timeline: Array<{
    bucketStart: string;
    samples: number;
    avgCpuPercent: number;
    avgMemoryUsedPercent: number;
    avgDiskUsedPercent: number;
  }>;
  latestByHost: Array<{
    agentId: string;
    hostId: string;
    hostname: string;
    receivedAt: string;
    health: string;
    queueDepth: number;
    cpuPercent: number;
    memoryUsedPercent: number;
    diskUsedPercent: number;
    load1: number;
  }>;
}

interface ParsedSystemSample {
  agentId: string;
  hostId: string;
  hostname: string;
  receivedAt: Date;
  health: string;
  queueDepth: number;
  cpuPercent: number;
  memoryUsedPercent: number | null;
  diskUsedPercent: number | null;
  load1: number;
}

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly clickhouseService: ClickhouseService,
  ) {}

  resolveFilters(
    range: AnalyticsRange,
    hostId?: string,
    agentId?: string,
  ): AnalyticsFilters {
    const normalizedRange = rangeOptions[range] ? range : '24h';
    const endAt = new Date();
    const startAt = new Date(
      endAt.getTime() - rangeOptions[normalizedRange].durationMs,
    );

    return {
      range: normalizedRange,
      hostId: hostId?.trim() || undefined,
      agentId: agentId?.trim() || undefined,
      startAt,
      endAt,
      bucketMinutes: rangeOptions[normalizedRange].bucketMinutes,
    };
  }

  async getOverview(
    filters: AnalyticsFilters,
  ): Promise<OverviewAnalyticsResult> {
    await this.databaseService.ensureInitialized();

    const [logTotals, agentTotals, systemRows] = await Promise.all([
      this.fetchLogTotals(filters),
      this.fetchAgentTotals(filters),
      this.fetchSystemRows(filters),
    ]);

    const systemSummary = summarizeSystemRows(systemRows.map(parseSystemRow));

    return {
      generatedAt: new Date().toISOString(),
      range: filters.range,
      startAt: filters.startAt.toISOString(),
      endAt: filters.endAt.toISOString(),
      filters: {
        hostId: filters.hostId,
        agentId: filters.agentId,
      },
      totals: {
        matchedAgents: agentTotals.matchedAgents,
        activeAgents: agentTotals.activeAgents,
        matchedHosts: agentTotals.matchedHosts,
        totalLogs: logTotals.totalLogs,
        errorLogs: logTotals.errorLogs,
        warnLogs: logTotals.warnLogs,
        heartbeatSamples: systemSummary.sampleCount,
        unhealthyHeartbeats: systemSummary.unhealthySamples,
        avgCpuPercent: systemSummary.avgCpuPercent,
        avgMemoryUsedPercent: systemSummary.avgMemoryUsedPercent,
        avgDiskUsedPercent: systemSummary.avgDiskUsedPercent,
      },
    };
  }

  async getLogs(filters: AnalyticsFilters): Promise<LogsAnalyticsResult> {
    const previousRange = getPreviousRange(filters);
    const [
      volumeRows,
      previousVolumeRows,
      levelRows,
      sourceRows,
      topHostRows,
      totalRows,
      previousTotalRows,
      heatmapRows,
      topErrorRows,
    ] =
      await Promise.all([
        this.fetchVolumeRows(filters, filters.startAt, filters.endAt),
        this.fetchVolumeRows(filters, previousRange.startAt, previousRange.endAt),
        this.clickhouseService.queryJsonEachRow(`
        SELECT
          if(empty(level), 'unknown', level) AS key,
          count() AS count
        FROM logs_raw
        WHERE ${buildClickhouseWhereBetween(filters, filters.startAt, filters.endAt)}
        GROUP BY key
        ORDER BY count DESC, key ASC
        LIMIT 10
        FORMAT JSONEachRow
      `),
        this.clickhouseService.queryJsonEachRow(`
        SELECT
          if(empty(source_type), 'unknown', source_type) AS key,
          count() AS count
        FROM logs_raw
        WHERE ${buildClickhouseWhereBetween(filters, filters.startAt, filters.endAt)}
        GROUP BY key
        ORDER BY count DESC, key ASC
        LIMIT 10
        FORMAT JSONEachRow
      `),
        this.clickhouseService.queryJsonEachRow(`
        SELECT
          host_id,
          count() AS count
        FROM logs_raw
        WHERE ${buildClickhouseWhereBetween(filters, filters.startAt, filters.endAt)}
        GROUP BY host_id
        ORDER BY count DESC, host_id ASC
        LIMIT 10
        FORMAT JSONEachRow
      `),
        this.fetchLogTotalsBetween(filters, filters.startAt, filters.endAt),
        this.fetchLogTotalsBetween(filters, previousRange.startAt, previousRange.endAt),
        this.clickhouseService.queryJsonEachRow(`
        SELECT
          toString(toDate(parseDateTime64BestEffort(timestamp))) AS day,
          toHour(parseDateTime64BestEffort(timestamp)) AS hour,
          count() AS error_count
        FROM logs_raw
        WHERE ${buildClickhouseWhereBetween(filters, filters.startAt, filters.endAt, ["level = 'error'"])}
        GROUP BY day, hour
        ORDER BY day ASC, hour ASC
        FORMAT JSONEachRow
      `),
        this.clickhouseService.queryJsonEachRow(`
        SELECT
          message,
          count() AS count,
          toString(max(parseDateTime64BestEffort(timestamp))) AS last_seen_at
        FROM logs_raw
        WHERE ${buildClickhouseWhereBetween(filters, filters.startAt, filters.endAt, ["level = 'error'", 'message != \'\''])}
        GROUP BY message
        ORDER BY count DESC, last_seen_at DESC, message ASC
        LIMIT 10
        FORMAT JSONEachRow
      `),
      ]);

    const volume = buildVolumeSeries(
      filters.startAt,
      filters.endAt,
      filters.bucketMinutes,
      volumeRows,
    );
    const previousVolume = buildVolumeSeries(
      previousRange.startAt,
      previousRange.endAt,
      filters.bucketMinutes,
      previousVolumeRows,
    );

    return {
      generatedAt: new Date().toISOString(),
      range: filters.range,
      startAt: filters.startAt.toISOString(),
      endAt: filters.endAt.toISOString(),
      bucketMinutes: filters.bucketMinutes,
      totalLogs: toNumber(totalRows.totalLogs),
      volume,
      errorHeatmap: heatmapRows.map((row) => ({
        day: toStringValue(row.day),
        hour: toNumber(row.hour),
        errorCount: toNumber(row.error_count),
      })),
      topErrorMessages: topErrorRows.map((row) => ({
        message: toStringValue(row.message),
        count: toNumber(row.count),
        lastSeenAt: toStringValue(row.last_seen_at),
      })),
      comparison: {
        currentTotalLogs: totalRows.totalLogs,
        previousTotalLogs: previousTotalRows.totalLogs,
        currentErrorLogs: totalRows.errorLogs,
        previousErrorLogs: previousTotalRows.errorLogs,
      },
      volumeComparison: volume.map((point, index) => ({
        bucketStart: point.bucketStart,
        currentTotalLogs: point.totalLogs,
        previousTotalLogs: previousVolume[index]?.totalLogs ?? 0,
      })),
      byLevel: levelRows.map((row) => ({
        key: toStringValue(row.key) || 'unknown',
        count: toNumber(row.count),
      })),
      bySource: sourceRows.map((row) => ({
        key: toStringValue(row.key) || 'unknown',
        count: toNumber(row.count),
      })),
      topHosts: topHostRows.map((row) => ({
        hostId: toStringValue(row.host_id) || 'unknown',
        count: toNumber(row.count),
      })),
    };
  }

  async getSystem(filters: AnalyticsFilters): Promise<SystemAnalyticsResult> {
    await this.databaseService.ensureInitialized();
    const rows = await this.fetchSystemRows(filters);
    const parsed = rows.map(parseSystemRow);
    const summary = summarizeSystemRows(parsed);
    const timelineMap = new Map<
      string,
      {
        cpuSum: number;
        cpuCount: number;
        memSum: number;
        memCount: number;
        diskSum: number;
        diskCount: number;
        samples: number;
      }
    >();
    const latestByHost = new Map<string, ParsedSystemSample>();

    for (const sample of parsed) {
      const bucketStart = toBucketStart(
        sample.receivedAt,
        filters.bucketMinutes,
      ).toISOString();
      const bucket = timelineMap.get(bucketStart) ?? {
        cpuSum: 0,
        cpuCount: 0,
        memSum: 0,
        memCount: 0,
        diskSum: 0,
        diskCount: 0,
        samples: 0,
      };

      bucket.cpuSum += sample.cpuPercent;
      bucket.cpuCount += 1;
      if (sample.memoryUsedPercent !== null) {
        bucket.memSum += sample.memoryUsedPercent;
        bucket.memCount += 1;
      }
      if (sample.diskUsedPercent !== null) {
        bucket.diskSum += sample.diskUsedPercent;
        bucket.diskCount += 1;
      }
      bucket.samples += 1;
      timelineMap.set(bucketStart, bucket);

      if (!latestByHost.has(sample.hostId)) {
        latestByHost.set(sample.hostId, sample);
      }
    }

    return {
      generatedAt: new Date().toISOString(),
      range: filters.range,
      startAt: filters.startAt.toISOString(),
      endAt: filters.endAt.toISOString(),
      bucketMinutes: filters.bucketMinutes,
      summary,
      timeline: Array.from(timelineMap.entries())
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([bucketStart, bucket]) => ({
          bucketStart,
          samples: bucket.samples,
          avgCpuPercent: average(bucket.cpuSum, bucket.cpuCount),
          avgMemoryUsedPercent: average(bucket.memSum, bucket.memCount),
          avgDiskUsedPercent: average(bucket.diskSum, bucket.diskCount),
        })),
      latestByHost: Array.from(latestByHost.values())
        .sort((left, right) => left.hostId.localeCompare(right.hostId))
        .map((sample) => ({
          agentId: sample.agentId,
          hostId: sample.hostId,
          hostname: sample.hostname,
          receivedAt: sample.receivedAt.toISOString(),
          health: sample.health,
          queueDepth: sample.queueDepth,
          cpuPercent: sample.cpuPercent,
          memoryUsedPercent: sample.memoryUsedPercent ?? 0,
          diskUsedPercent: sample.diskUsedPercent ?? 0,
          load1: sample.load1,
        })),
    };
  }

  private async fetchLogTotals(filters: AnalyticsFilters): Promise<{
    totalLogs: number;
    errorLogs: number;
    warnLogs: number;
  }> {
    return this.fetchLogTotalsBetween(filters, filters.startAt, filters.endAt);
  }

  private async fetchLogTotalsBetween(
    filters: AnalyticsFilters,
    startAt: Date,
    endAt: Date,
  ): Promise<{
    totalLogs: number;
    errorLogs: number;
    warnLogs: number;
  }> {
    const rows = await this.clickhouseService.queryJsonEachRow(`
      SELECT
        count() AS total_logs,
        countIf(level = 'error') AS error_logs,
        countIf(level = 'warn') AS warn_logs
      FROM logs_raw
      WHERE ${buildClickhouseWhereBetween(filters, startAt, endAt)}
      FORMAT JSONEachRow
    `);

    return {
      totalLogs: toNumber(rows[0]?.total_logs),
      errorLogs: toNumber(rows[0]?.error_logs),
      warnLogs: toNumber(rows[0]?.warn_logs),
    };
  }

  private async fetchVolumeRows(
    filters: AnalyticsFilters,
    startAt: Date,
    endAt: Date,
  ): Promise<Record<string, unknown>[]> {
    return this.clickhouseService.queryJsonEachRow(`
      SELECT
        toUnixTimestamp(toStartOfInterval(parseDateTime64BestEffort(timestamp), INTERVAL ${filters.bucketMinutes} MINUTE)) AS bucket_ts,
        count() AS total_logs,
        countIf(level = 'error') AS error_logs,
        countIf(level = 'warn') AS warn_logs
      FROM logs_raw
      WHERE ${buildClickhouseWhereBetween(filters, startAt, endAt)}
      GROUP BY bucket_ts
      ORDER BY bucket_ts ASC
      FORMAT JSONEachRow
    `);
  }

  private async fetchAgentTotals(filters: AnalyticsFilters): Promise<{
    matchedAgents: number;
    activeAgents: number;
    matchedHosts: number;
  }> {
    const rows = await this.databaseService.query<{
      matched_agents: number | string;
      active_agents: number | string;
      matched_hosts: number | string;
    }>(
      `
        SELECT
          COUNT(*)::int AS matched_agents,
          COUNT(*) FILTER (WHERE last_seen_at >= NOW() - INTERVAL '5 minutes')::int AS active_agents,
          COUNT(DISTINCT host_id)::int AS matched_hosts
        FROM agents
        WHERE ($1::text IS NULL OR host_id = $1)
          AND ($2::text IS NULL OR id = $2)
      `,
      [filters.hostId ?? null, filters.agentId ?? null],
    );

    return {
      matchedAgents: toNumber(rows[0]?.matched_agents),
      activeAgents: toNumber(rows[0]?.active_agents),
      matchedHosts: toNumber(rows[0]?.matched_hosts),
    };
  }

  private async fetchSystemRows(
    filters: AnalyticsFilters,
  ): Promise<RawSystemRow[]> {
    return this.databaseService.query<RawSystemRow>(
      `
        SELECT
          h.received_at,
          h.payload,
          a.id AS agent_id,
          a.host_id,
          a.hostname
        FROM heartbeat_history h
        INNER JOIN agents a ON a.id = h.agent_id
        WHERE h.received_at >= $1
          AND h.received_at <= $2
          AND ($3::text IS NULL OR a.host_id = $3)
          AND ($4::text IS NULL OR a.id = $4)
        ORDER BY h.received_at DESC
      `,
      [
        filters.startAt,
        filters.endAt,
        filters.hostId ?? null,
        filters.agentId ?? null,
      ],
    );
  }
}

interface RawSystemRow {
  agent_id: string;
  host_id: string;
  hostname: string;
  received_at: string | Date;
  payload: unknown;
}

const rangeOptions: Record<
  AnalyticsRange,
  { durationMs: number; bucketMinutes: number }
> = {
  '1h': { durationMs: 60 * 60 * 1000, bucketMinutes: 5 },
  '6h': { durationMs: 6 * 60 * 60 * 1000, bucketMinutes: 15 },
  '24h': { durationMs: 24 * 60 * 60 * 1000, bucketMinutes: 60 },
  '7d': { durationMs: 7 * 24 * 60 * 60 * 1000, bucketMinutes: 360 },
};

function buildClickhouseWhere(filters: AnalyticsFilters): string {
  return buildClickhouseWhereBetween(filters, filters.startAt, filters.endAt);
}

function buildClickhouseWhereBetween(
  filters: AnalyticsFilters,
  startAt: Date,
  endAt: Date,
  extraClauses: string[] = [],
): string {
  const clauses = [
    `parseDateTime64BestEffort(timestamp) >= parseDateTime64BestEffort(${quoteSqlString(startAt.toISOString())})`,
    `parseDateTime64BestEffort(timestamp) <= parseDateTime64BestEffort(${quoteSqlString(endAt.toISOString())})`,
  ];

  if (filters.hostId) {
    clauses.push(`host_id = ${quoteSqlString(filters.hostId)}`);
  }
  if (filters.agentId) {
    clauses.push(`agent_id = ${quoteSqlString(filters.agentId)}`);
  }

  clauses.push(...extraClauses);

  return clauses.join(' AND ');
}

function buildVolumeSeries(
  startAt: Date,
  endAt: Date,
  bucketMinutes: number,
  rows: Record<string, unknown>[],
): LogsAnalyticsResult['volume'] {
  const bucketMs = bucketMinutes * 60 * 1000;
  const bucketMap = new Map<number, { totalLogs: number; errorLogs: number; warnLogs: number }>();

  for (const row of rows) {
    bucketMap.set(toNumber(row.bucket_ts) * 1000, {
      totalLogs: toNumber(row.total_logs),
      errorLogs: toNumber(row.error_logs),
      warnLogs: toNumber(row.warn_logs),
    });
  }

  const points: LogsAnalyticsResult['volume'] = [];
  for (let current = toBucketStart(startAt, bucketMinutes).getTime(); current <= endAt.getTime(); current += bucketMs) {
    const value = bucketMap.get(current) ?? { totalLogs: 0, errorLogs: 0, warnLogs: 0 };
    points.push({
      bucketStart: new Date(current).toISOString(),
      totalLogs: value.totalLogs,
      errorLogs: value.errorLogs,
      warnLogs: value.warnLogs,
    });
  }

  return points;
}

function getPreviousRange(filters: AnalyticsFilters): { startAt: Date; endAt: Date } {
  const durationMs = filters.endAt.getTime() - filters.startAt.getTime();
  return {
    startAt: new Date(filters.startAt.getTime() - durationMs),
    endAt: new Date(filters.startAt.getTime()),
  };
}

function parseSystemRow(row: RawSystemRow): ParsedSystemSample {
  const payload = toRecord(row.payload);
  const system = toRecord(payload.system);
  const memoryUsedPercent = toPercent(
    toNumberOrNull(system.memoryUsedBytes),
    toNumberOrNull(system.memoryTotalBytes),
  );
  const diskUsedPercent = toPercent(
    toNumberOrNull(system.diskUsedBytes),
    toNumberOrNull(system.diskTotalBytes),
  );

  return {
    agentId: row.agent_id,
    hostId: row.host_id,
    hostname: row.hostname,
    receivedAt:
      row.received_at instanceof Date
        ? row.received_at
        : new Date(row.received_at),
    health: typeof payload.health === 'string' ? payload.health : 'unknown',
    queueDepth: toNumber(payload.queueDepth),
    cpuPercent: toNumber(system.cpuPercent),
    memoryUsedPercent,
    diskUsedPercent,
    load1: toNumber(system.load1),
  };
}

function summarizeSystemRows(
  rows: ParsedSystemSample[],
): SystemAnalyticsResult['summary'] {
  let unhealthySamples = 0;
  let cpuSum = 0;
  let cpuCount = 0;
  let maxCpuPercent = 0;
  let memSum = 0;
  let memCount = 0;
  let maxMemoryUsedPercent = 0;
  let diskSum = 0;
  let diskCount = 0;
  let maxDiskUsedPercent = 0;

  for (const row of rows) {
    if (row.health !== 'healthy') {
      unhealthySamples += 1;
    }

    cpuSum += row.cpuPercent;
    cpuCount += 1;
    maxCpuPercent = Math.max(maxCpuPercent, row.cpuPercent);

    if (row.memoryUsedPercent !== null) {
      memSum += row.memoryUsedPercent;
      memCount += 1;
      maxMemoryUsedPercent = Math.max(
        maxMemoryUsedPercent,
        row.memoryUsedPercent,
      );
    }

    if (row.diskUsedPercent !== null) {
      diskSum += row.diskUsedPercent;
      diskCount += 1;
      maxDiskUsedPercent = Math.max(maxDiskUsedPercent, row.diskUsedPercent);
    }
  }

  return {
    sampleCount: rows.length,
    unhealthySamples,
    avgCpuPercent: average(cpuSum, cpuCount),
    maxCpuPercent,
    avgMemoryUsedPercent: average(memSum, memCount),
    maxMemoryUsedPercent,
    avgDiskUsedPercent: average(diskSum, diskCount),
    maxDiskUsedPercent,
  };
}

function toBucketStart(value: Date, bucketMinutes: number): Date {
  const bucketMs = bucketMinutes * 60 * 1000;
  return new Date(Math.floor(value.getTime() / bucketMs) * bucketMs);
}

function average(sum: number, count: number): number {
  if (count === 0) {
    return 0;
  }

  return sum / count;
}

function toPercent(used: number | null, total: number | null): number | null {
  if (used === null || total === null || total <= 0) {
    return null;
  }

  return (used / total) * 100;
}

function toNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toStringValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return `${value}`;
  }
  if (value === null || value === undefined) {
    return '';
  }
  return '';
}

function toRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
