import { Global, Module } from '@nestjs/common';
import { ClickhouseModule } from '../clickhouse/clickhouse.module';
import { DatabaseModule } from '../database/database.module';
import { HousekeepingService } from './housekeeping.service';
import { MonitoringController } from './monitoring.controller';
import { MonitoringService } from './monitoring.service';

@Global()
@Module({
  imports: [DatabaseModule, ClickhouseModule],
  controllers: [MonitoringController],
  providers: [MonitoringService, HousekeepingService],
  exports: [MonitoringService],
})
export class MonitoringModule {}
