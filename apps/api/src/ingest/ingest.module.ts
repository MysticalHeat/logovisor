import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { ClickhouseModule } from '../clickhouse/clickhouse.module';
import { IngestController } from './ingest.controller';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [DatabaseModule, ClickhouseModule, AdminModule],
  controllers: [IngestController],
})
export class IngestModule {}
