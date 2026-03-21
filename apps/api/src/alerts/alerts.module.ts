import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ClickhouseModule } from '../clickhouse/clickhouse.module';
import { DatabaseModule } from '../database/database.module';
import { AlertsController } from './alerts.controller';
import { AlertsRuntimeService } from './alerts.runtime.service';
import { AlertsService } from './alerts.service';

@Module({
  imports: [AuthModule, DatabaseModule, ClickhouseModule],
  controllers: [AlertsController],
  providers: [AlertsService, AlertsRuntimeService],
  exports: [AlertsService],
})
export class AlertsModule {}
