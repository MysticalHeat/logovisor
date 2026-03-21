import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';
import { ClickhouseService } from '../clickhouse/clickhouse.service';
import { MonitoringService } from './monitoring.service';

@Injectable()
export class HousekeepingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HousekeepingService.name);
  private intervalHandle?: NodeJS.Timeout;

  constructor(
    private readonly configService: ConfigService,
    private readonly databaseService: DatabaseService,
    private readonly clickhouseService: ClickhouseService,
    private readonly monitoringService: MonitoringService,
  ) {}

  onModuleInit(): void {
    const intervalSeconds = Number(
      this.configService.get<string>('LOGOVISOR_HOUSEKEEPING_INTERVAL_SECONDS') ??
        '3600',
    );

    this.intervalHandle = setInterval(() => {
      void this.run();
    }, intervalSeconds * 1000);
    this.intervalHandle.unref();
  }

  onModuleDestroy(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
    }
  }

  async run(): Promise<void> {
    const heartbeatRetentionDays = Number(
      this.configService.get<string>('LOGOVISOR_HEARTBEAT_RETENTION_DAYS') ?? '7',
    );
    const tokenRetentionDays = Number(
      this.configService.get<string>('LOGOVISOR_TOKEN_RETENTION_DAYS') ?? '7',
    );
    const logRetentionDays = Number(
      this.configService.get<string>('LOGOVISOR_LOG_RETENTION_DAYS') ?? '30',
    );

    try {
      await this.databaseService.ensureInitialized();
      await this.databaseService.db.execute(`
        DELETE FROM heartbeat_history
        WHERE received_at < NOW() - INTERVAL '${heartbeatRetentionDays} days';
      `);
      await this.databaseService.db.execute(`
        DELETE FROM enrollment_tokens
        WHERE (
          expires_at < NOW() - INTERVAL '${tokenRetentionDays} days'
          OR used_at < NOW() - INTERVAL '${tokenRetentionDays} days'
          OR revoked_at < NOW() - INTERVAL '${tokenRetentionDays} days'
        );
      `);
      await this.databaseService.db.execute(`
        DELETE FROM agent_tokens
        WHERE revoked_at < NOW() - INTERVAL '${tokenRetentionDays} days';
      `);
      await this.clickhouseService.purgeLogsOlderThan(logRetentionDays);
      this.monitoringService.recordHousekeeping(true);
    } catch (error) {
      this.monitoringService.recordHousekeeping(false);
      this.logger.error('housekeeping failed', error instanceof Error ? error.stack : undefined);
    }
  }
}
