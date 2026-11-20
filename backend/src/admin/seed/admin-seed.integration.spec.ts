import { compare, hash } from 'bcryptjs';
import { JwtService } from '@nestjs/jwt';
import {
  Model,
  MongooseUpdateQueryOptions,
  RootFilterQuery,
  UpdateQuery,
} from 'mongoose';
import request from 'supertest';
import {
  AuthTestApp,
  createAuthTestApp,
  TEST_ACCESS_SECRET,
} from '../../../test/helpers/auth-test-app';
import { AccountStatus, Role } from '../../common';
import { User } from '../../users/schemas/user.schema';
import { readAdminSeedConfig } from './admin-seed.config';
import {
  AdminSeedCollisionError,
  seedAdministrator,
} from './seed-administrator';

jest.mock('dotenv', () => ({
  ...jest.requireActual<typeof import('dotenv')>('dotenv'),
  config: jest.fn(() => ({ parsed: {} })),
}));

jest.setTimeout(120000);

describe('administrator seed with the existing User schema and real auth HTTP endpoints', () => {
  let fixture: AuthTestApp;
  let users: Model<User>;
  const config = readAdminSeedConfig({
    ADMIN_SEED_NAME: 'Fixture Administrator',
    ADMIN_SEED_EMAIL: 'admin@example.test',
    ADMIN_SEED_PASSWORD: 'TestAdmin9Password!',
  });
  const login = (email = config.email, password = config.password) =>
    request(fixture.app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password });
  const register = (extra: object = {}) =>
    request(fixture.app.getHttpServer())
      .post('/api/auth/register')
      .send({
        name: 'Fixture User',
        email: 'user@example.test',
        password: 'TestUser9Password!',
        acceptTerms: true,
        ...extra,
      });

  beforeAll(async () => {
    fixture = await createAuthTestApp([], {
      cookieSecure: true,
      swagger: true,
    });
    fixture.app.useLogger(false);
    users = fixture.connection.model<User>(User.name);
  });
  beforeEach(async () => {
    await users.deleteMany({});
  }); // The helper's own disposable MongoDB only.
  afterEach(() => {
    jest.restoreAllMocks();
  });
  afterAll(async () => {
    await fixture?.close();
  });

  it('creates an ACTIVE ADMIN with a cost-10 bcrypt hash and all required schema fields', async () => {
    const before = new Date();
    expect(await seedAdministrator(users, config)).toBe('created');
    const stored = await users
      .findOne({ email: config.email })
      .select('+passwordHash')
      .lean();
    expect(stored).toMatchObject({
      email: config.email,
      name: config.name,
      role: Role.ADMIN,
      status: AccountStatus.ACTIVE,
      consentAcceptedAt: expect.any(Date),
      createdAt: expect.any(Date),
      updatedAt: expect.any(Date),
      preferredCurrency: expect.any(String),
    });
    expect(stored!.passwordHash).toMatch(/^\$2[aby]\$10\$/);
    expect(stored!.passwordHash).not.toBe(config.password);
    expect(await compare(config.password, stored!.passwordHash)).toBe(true);
    expect(stored!.consentAcceptedAt.getTime()).toBeGreaterThanOrEqual(
      before.getTime(),
    );
    expect(stored!.consentAcceptedAt).toEqual(stored!.createdAt);
    expect(stored).not.toHaveProperty('password');
    expect(await users.countDocuments()).toBe(1);
  });

  it('is idempotent after email normalization and preserves password, status, timestamps and other fields', async () => {
    await seedAdministrator(users, config);
    await users.updateOne(
      { email: config.email },
      {
        $set: {
          name: 'Keep this name',
          preferredCurrency: 'EUR',
          status: AccountStatus.SUSPENDED,
        },
      },
    );
    const before = await users.collection.findOne({ email: config.email });
    expect(
      await seedAdministrator(users, {
        ...config,
        email: ' ADMIN@Example.Test ',
        password: 'ChangedButNotReset9!',
        name: 'Do not apply',
      }),
    ).toBe('already-exists');
    expect(await users.collection.findOne({ email: config.email })).toEqual(
      before,
    );
    expect(await users.countDocuments({ role: Role.ADMIN })).toBe(1);
  });

  it('does not change unrelated ordinary users or other administrators', async () => {
    const passwordHash = await hash('OtherFixture9!', 10);
    await users.create([
      {
        name: 'Other User',
        email: 'other-user@example.test',
        passwordHash,
        consentAcceptedAt: new Date(),
      },
      {
        name: 'Other Admin',
        email: 'other-admin@example.test',
        passwordHash,
        role: Role.ADMIN,
        status: AccountStatus.DEACTIVATED,
        consentAcceptedAt: new Date(),
      },
    ]);
    const before = await users.collection.find({}).sort({ email: 1 }).toArray();
    await seedAdministrator(users, config);
    await seedAdministrator(users, config);
    expect(
      await users.collection
        .find({ email: { $ne: config.email } })
        .sort({ email: 1 })
        .toArray(),
    ).toEqual(before);
  });

  it.each([Role.USER, Role.AIRLINE_MODERATOR, Role.HOTEL_MODERATOR])(
    'refuses an existing %s account without modifying it',
    async (role) => {
      await users.create({
        name: 'Existing Account',
        email: config.email,
        passwordHash: await hash('ExistingFixture9!', 10),
        role,
        consentAcceptedAt: new Date(),
      });
      const before = await users.collection.findOne({ email: config.email });
      await expect(seedAdministrator(users, config)).rejects.toBeInstanceOf(
        AdminSeedCollisionError,
      );
      expect(await users.collection.findOne({ email: config.email })).toEqual(
        before,
      );
      expect(await users.countDocuments({ role: Role.ADMIN })).toBe(0);
    },
  );

  it('supports concurrent seed executions without duplicate administrators', async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, () => seedAdministrator(users, config)),
    );
    expect(results.filter((result) => result === 'created')).toHaveLength(1);
    expect(
      results.filter((result) => result === 'already-exists'),
    ).toHaveLength(5);
    expect(await users.countDocuments({ email: config.email })).toBe(1);
  });

  it('does not promote or modify a normal user that wins the race after the initial lookup', async () => {
    const passwordHash = await hash('RacingFixture9!', 10);
    let existingAccount: unknown;
    const updateOne = users.updateOne.bind(users);
    jest
      .spyOn(users, 'updateOne')
      .mockImplementationOnce((...args: unknown[]) => {
        // Jest selects Mongoose's final overload; the seeder uses the three-argument form.
        const operation = updateOne<unknown>(
          args[0] as RootFilterQuery<User>,
          args[1] as UpdateQuery<User>,
          args[2] as MongooseUpdateQueryOptions<User> & { upsert: boolean },
        );
        const execute = operation.exec.bind(operation);
        jest.spyOn(operation, 'exec').mockImplementationOnce(async () => {
          // Insert a real USER after the seed's empty lookup, just before its atomic upsert.
          await users.create({
            name: 'Racing User',
            email: config.email,
            passwordHash,
            consentAcceptedAt: new Date(),
          });
          existingAccount = await users.collection.findOne({
            email: config.email,
          });
          return execute();
        });
        return operation;
      });
    await expect(seedAdministrator(users, config)).rejects.toBeInstanceOf(
      AdminSeedCollisionError,
    );
    expect(await users.collection.findOne({ email: config.email })).toEqual(
      existingAccount,
    );
    expect(await users.countDocuments({ role: Role.ADMIN })).toBe(0);
  });

  it('validates credentials before index creation or account writes', async () => {
    const indexes = jest.spyOn(users, 'createIndexes');
    await expect(
      seedAdministrator(users, { ...config, password: 'short' }),
    ).rejects.toThrow('Invalid administrator seed configuration');
    expect(indexes).not.toHaveBeenCalled();
    expect(await users.countDocuments()).toBe(0);
  });

  it('rejects ADMIN and lowercase admin registration attempts; ordinary registration remains USER', async () => {
    for (const role of ['ADMIN', 'admin']) {
      const result = await register({ role }).expect(400);
      expect(result.body).toMatchObject({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Validation failed',
        path: '/api/auth/register',
      });
      expect(result.body.details).toContainEqual({
        field: 'role',
        message: expect.any(String),
      });
    }
    expect(await users.countDocuments()).toBe(0);
    const result = await register().expect(201);
    expect(result.body).toMatchObject({
      role: Role.USER,
      status: AccountStatus.ACTIVE,
    });
    expect(await users.countDocuments({ role: Role.ADMIN })).toBe(0);
    expect(JSON.stringify(result.body)).not.toMatch(
      /passwordHash|TestUser9Password/,
    );
  });

  it('logs in through the existing endpoint with ADMIN identity, safe response DTO and secure cookies', async () => {
    await seedAdministrator(users, config);
    const result = await login(' ADMIN@Example.Test ').expect(200);
    expect(result.body).toMatchObject({
      role: Role.ADMIN,
      status: AccountStatus.ACTIVE,
      email: config.email,
    });
    expect(JSON.stringify(result.body)).not.toMatch(
      /passwordHash|accessToken|refreshToken|TestAdmin9Password/,
    );
    const cookies = result.headers['set-cookie'] as unknown as string[];
    expect(cookies).toHaveLength(2);
    for (const cookie of cookies) {
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('Secure');
      expect(cookie).toContain('SameSite=Lax');
    }
    const access = cookies.find((cookie) =>
      cookie.startsWith('access_token='),
    )!;
    const refresh = cookies.find((cookie) =>
      cookie.startsWith('refresh_token='),
    )!;
    expect(access).toContain('Path=/;');
    expect(refresh).toContain('Path=/api/auth;');
    const payload = new JwtService().verify(
      access.split(';')[0].slice('access_token='.length),
      { secret: TEST_ACCESS_SECRET },
    );
    expect(payload.role).toBe(Role.ADMIN);
    await request(fixture.app.getHttpServer())
      .get('/api/auth/me')
      .set('Cookie', access.split(';')[0])
      .expect(200);
  });

  it('rejects wrong-password and nonexistent-account login with the same safe response', async () => {
    await seedAdministrator(users, config);
    for (const [email, password] of [
      [config.email, 'IncorrectFixture9!'],
      ['missing@example.test', config.password],
    ]) {
      const result = await login(email, password).expect(401);
      expect(result.body.message).toBe('Invalid email or password');
      expect(result.headers['set-cookie']).toBeUndefined();
    }
  });

  it('keeps account status checks enforced for seeded administrators', async () => {
    await seedAdministrator(users, config);
    const result = await login().expect(200);
    const access = (result.headers['set-cookie'] as unknown as string[])
      .find((cookie) => cookie.startsWith('access_token='))!
      .split(';')[0];
    await users.updateOne(
      { email: config.email },
      { $set: { status: AccountStatus.SUSPENDED } },
    );
    await login().expect(403);
    await request(fixture.app.getHttpServer())
      .get('/api/auth/me')
      .set('Cookie', access)
      .expect(401);
    await users.updateOne(
      { email: config.email },
      { $set: { status: AccountStatus.DEACTIVATED } },
    );
    await login().expect(401);
  });

  it('verifies existing Swagger login/registration schemas with no administrator creation route or role option', async () => {
    const result = await request(fixture.app.getHttpServer())
      .get('/api/docs-json')
      .expect(200);
    expect(result.body.paths['/api/auth/login'].post.responses).toHaveProperty(
      '200',
    );
    expect(
      result.body.paths['/api/auth/register'].post.responses,
    ).toHaveProperty('400');
    expect(
      result.body.components.schemas.RegisterDto.properties,
    ).not.toHaveProperty('role');
    expect(result.body.paths).not.toHaveProperty('/api/admin/register');
    await request(fixture.app.getHttpServer())
      .post('/api/admin/register')
      .send({ role: 'ADMIN' })
      .expect(404);
  });
});
