import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { setupApp, setupSwagger } from './setup-app';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  setupApp(app, config.get<string>('frontendUrl'));
  setupSwagger(app);

  const port = config.get<number>('port') ?? 3001;
  await app.listen(port);
  new Logger('Bootstrap').log(`API running on http://localhost:${port}/api (Swagger: /api/docs)`);
}

bootstrap();
