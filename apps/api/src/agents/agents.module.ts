import { Module } from '@nestjs/common';
import { AgentsController } from './agents.controller';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [AgentsController],
})
export class AgentsModule {}
