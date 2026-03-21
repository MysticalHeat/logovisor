import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { AgentsModule } from './agents/agents.module';
import { IngestModule } from './ingest/ingest.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    AgentsModule,
    IngestModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
