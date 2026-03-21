import { Module } from '@nestjs/common';
import { ClickhouseModule } from '../clickhouse/clickhouse.module';
import { IngestController } from './ingest.controller';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [DatabaseModule, ClickhouseModule],
  controllers: [IngestController],
})
export class IngestModule {}
