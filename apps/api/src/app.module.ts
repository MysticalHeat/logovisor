import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'node:path';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AdminModule } from './admin/admin.module';
import { AuthModule } from './auth/auth.module';
import { DatabaseModule } from './database/database.module';
import { AgentsModule } from './agents/agents.module';
import { IngestModule } from './ingest/ingest.module';
import { MonitoringModule } from './monitoring/monitoring.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ServeStaticModule.forRoot({
      rootPath:
        process.env.LOGOVISOR_ADMIN_STATIC_DIR ??
        join(process.cwd(), 'apps', 'admin', 'dist'),
      serveRoot: '/admin',
    }),
    AdminModule,
    AuthModule,
    DatabaseModule,
    AgentsModule,
    IngestModule,
    MonitoringModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
