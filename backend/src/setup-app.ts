import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { ACCESS_TOKEN_COOKIE } from './common/constants';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { createValidationPipe } from './common/pipes/validation.pipe';

/** Global behaviour shared by the real app (main.ts) and the e2e tests. */
export function setupApp(app: INestApplication, frontendUrl = 'http://localhost:3000'): void {
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new AllExceptionsFilter());
  // credentials: true lets the browser send/receive the httpOnly auth cookies
  app.enableCors({ origin: frontendUrl, credentials: true });
}

/**
 * Swagger UI at /api/docs. `@ApiCookieAuth()` on a controller/route refers to this scheme.
 * The cookie is set by POST /api/auth/login; Swagger "Try it out" then sends it automatically.
 */
export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Travel Planning and Booking Platform API')
    .setDescription('GIU Software Project I - Milestone 1 backend. Log in first (POST /api/auth/login) so the auth cookie is set.')
    .setVersion('1.0')
    .addCookieAuth(ACCESS_TOKEN_COOKIE)
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document, { swaggerOptions: { persistAuthorization: true } });
}
