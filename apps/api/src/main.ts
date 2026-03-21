import { NestFactory } from '@nestjs/core';
import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { DatabaseService } from './database/database.service';
import { HttpErrorFilter } from './shared/error-response';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new HttpErrorFilter());
  app.setGlobalPrefix('api', {
    exclude: [
      { path: 'health', method: RequestMethod.GET },
      { path: 'ready', method: RequestMethod.GET },
      { path: 'metrics', method: RequestMethod.GET },
    ],
  });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('logovisor api')
    .setDescription('Master API for agent enrollment, heartbeat, and log ingestion.')
    .setVersion('0.1.0')
    .addCookieAuth('logovisor_operator_session', {
      type: 'apiKey',
      in: 'cookie',
      name: 'logovisor_operator_session',
    })
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'opaque token',
        description: 'Agent runtime bearer token.',
      },
      'agent-bearer',
    )
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, swaggerDocument, {
    jsonDocumentUrl: '/api/docs-json',
    yamlDocumentUrl: '/api/docs-yaml',
    swaggerOptions: {
      persistAuthorization: true,
    },
  });

  await app.get(DatabaseService).ensureInitialized();

  await app.listen(process.env.PORT ?? 3000, process.env.HOST ?? '0.0.0.0');
}

void bootstrap();
