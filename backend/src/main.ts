import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { setupApp, setupSwagger } from './setup-app';

async function bootstrap() {
  // rawBody: true stashes the unparsed Buffer on req.rawBody for every route IN ADDITION TO the
  // normal parsed req.body — nothing else changes. PAY-01's webhook needs the exact raw bytes to
  // verify Stripe's signature; every other route keeps using req.body as before.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const config = app.get(ConfigService);

  setupApp(app, config.get<string>('frontendUrl'));
  setupSwagger(app);

  const port = config.get<number>('port') ?? 3001;
  await app.listen(port);
  new Logger('Bootstrap').log(`API running on http://localhost:${port}/api (Swagger: /api/docs)`);
}

bootstrap();
