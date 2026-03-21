import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ClickhouseModule } from '../clickhouse/clickhouse.module';
import { DatabaseModule } from '../database/database.module';
import { AdminController } from './admin.controller';

@Module({
  imports: [DatabaseModule, ClickhouseModule, AuthModule],
  controllers: [AdminController],
})
export class AdminModule {}
