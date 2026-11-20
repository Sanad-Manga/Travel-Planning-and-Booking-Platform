import { INestApplication, Type } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection } from 'mongoose';
import { AuthModule } from '../../src/auth/auth.module';
import configuration from '../../src/config/configuration';
import { setupApp, setupSwagger } from '../../src/setup-app';

// Fake values for tests only. They are NOT real secrets and never come from backend/.env.
export const TEST_ACCESS_SECRET = 'test-access-secret-0123456789-abcdefghijkl';
export const TEST_REFRESH_SECRET = 'test-refresh-secret-0123456789-abcdefghijk';

export interface AuthTestApp {
  app: INestApplication;
  connection: Connection;
  close: () => Promise<void>;
}

/** Boots the real AuthModule (global guards included) against an in-memory MongoDB with the real global pipe/filter. */
export async function createAuthTestApp(
  extraControllers: Type<unknown>[] = [],
  options: { cookieSecure?: boolean; swagger?: boolean } = {},
): Promise<AuthTestApp> {
  process.env.JWT_ACCESS_SECRET = TEST_ACCESS_SECRET;
  process.env.JWT_REFRESH_SECRET = TEST_REFRESH_SECRET;
  process.env.COOKIE_SECURE = String(options.cookieSecure ?? false);

  const mongo = await MongoMemoryServer.create();
  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [configuration] }),
      MongooseModule.forRoot(mongo.getUri()),
      AuthModule,
    ],
    controllers: extraControllers,
  }).compile();

  const app = moduleRef.createNestApplication();
  setupApp(app);
  if (options.swagger) setupSwagger(app);
  await app.init();

  const connection = app.get<Connection>(getConnectionToken());
  await connection.model('User').init(); // make sure the unique email index exists before the tests run

  return {
    app,
    connection,
    close: async () => {
      await app.close();
      await mongo.stop();
    },
  };
}
