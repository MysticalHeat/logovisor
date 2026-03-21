import { Injectable } from '@nestjs/common';

@Injectable()
export class MonitoringService {
  private readonly startedAt = Date.now();
  private enrollSuccessTotal = 0;
  private enrollFailureTotal = 0;
  private heartbeatSuccessTotal = 0;
  private heartbeatFailureTotal = 0;
  private ingestBatchesTotal = 0;
  private ingestEventsTotal = 0;
  private clickhouseWriteFailureTotal = 0;
  private adminLogSearchTotal = 0;
  private housekeepingRunTotal = 0;
  private housekeepingFailureTotal = 0;
  private lastHousekeepingRunAt: Date | null = null;

  recordEnroll(success: boolean): void {
    if (success) {
      this.enrollSuccessTotal += 1;
      return;
    }

    this.enrollFailureTotal += 1;
  }

  recordHeartbeat(success: boolean): void {
    if (success) {
      this.heartbeatSuccessTotal += 1;
      return;
    }

    this.heartbeatFailureTotal += 1;
  }

  recordIngestBatch(eventCount: number): void {
    this.ingestBatchesTotal += 1;
    this.ingestEventsTotal += eventCount;
  }

  recordClickhouseWriteFailure(): void {
    this.clickhouseWriteFailureTotal += 1;
  }

  recordAdminLogSearch(): void {
    this.adminLogSearchTotal += 1;
  }

  recordHousekeeping(success: boolean): void {
    this.lastHousekeepingRunAt = new Date();
    if (success) {
      this.housekeepingRunTotal += 1;
      return;
    }

    this.housekeepingFailureTotal += 1;
  }

  renderMetrics(): string {
    const uptimeSeconds = Math.floor((Date.now() - this.startedAt) / 1000);
    const lastRun = this.lastHousekeepingRunAt
      ? Math.floor(this.lastHousekeepingRunAt.getTime() / 1000)
      : 0;

    return [
      metric('logovisor_uptime_seconds', uptimeSeconds),
      metric('logovisor_enroll_success_total', this.enrollSuccessTotal),
      metric('logovisor_enroll_failure_total', this.enrollFailureTotal),
      metric('logovisor_heartbeat_success_total', this.heartbeatSuccessTotal),
      metric('logovisor_heartbeat_failure_total', this.heartbeatFailureTotal),
      metric('logovisor_ingest_batches_total', this.ingestBatchesTotal),
      metric('logovisor_ingest_events_total', this.ingestEventsTotal),
      metric(
        'logovisor_clickhouse_write_failure_total',
        this.clickhouseWriteFailureTotal,
      ),
      metric('logovisor_admin_log_search_total', this.adminLogSearchTotal),
      metric('logovisor_housekeeping_run_total', this.housekeepingRunTotal),
      metric(
        'logovisor_housekeeping_failure_total',
        this.housekeepingFailureTotal,
      ),
      metric(
        'logovisor_housekeeping_last_run_timestamp_seconds',
        lastRun,
      ),
    ].join('\n');
  }
}

function metric(name: string, value: number): string {
  return `${name} ${value}`;
}
