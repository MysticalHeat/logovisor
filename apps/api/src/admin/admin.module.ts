import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ClickhouseModule } from '../clickhouse/clickhouse.module';
import { DatabaseModule } from '../database/database.module';
import { AdminController } from './admin.controller';
import { LogStreamService } from './log-stream.service';

@Module({
  imports: [DatabaseModule, ClickhouseModule, AuthModule],
  controllers: [AdminController],
  providers: [LogStreamService],
  exports: [LogStreamService],
})
export class AdminModule {}
