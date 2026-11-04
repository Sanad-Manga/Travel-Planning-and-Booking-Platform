import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { hashSync } from 'bcryptjs';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { AirlinesModule } from '../src/airlines';
import { AuthModule } from '../src/auth/auth.module';
import { Role } from '../src/common';
import configuration from '../src/config/configuration';
import { setupApp, setupSwagger } from '../src/setup-app';
import {
  TEST_ACCESS_SECRET,
  TEST_REFRESH_SECRET,
} from './helpers/auth-test-app';

describe('airlines (FLT-01) over HTTP (e2e)', () => {
  let app: INestApplication;
  let mongo: MongoMemoryServer;
  let connection: Connection;

  const PASSWORD = 'Passw0rdOK';
  const http = () => request(app.getHttpServer());

  /** Inserts a user straight into MongoDB (registration never creates admins or moderators), then logs in. */
  async function loginAs(email: string, extra: Record<string, unknown> = {}) {
    await connection.collection('users').insertOne({
      name: 'Seeded',
      email,
      passwordHash: hashSync(PASSWORD, 4),
      role: Role.USER,
      status: 'ACTIVE',
      consentAcceptedAt: new Date(),
      preferredCurrency: 'USD',
      createdAt: new Date(),
      updatedAt: new Date(),
      ...extra,
    });
    const res = await http()
      .post('/api/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    const cookies = res.headers['set-cookie'] as unknown as string[];
    return cookies.map((c) => c.split(';')[0]).join('; ');
  }

  let admin: string;
  let user: string;
  let modOfA: string;
  let modOfB: string;
  let airlineA: { id: string; code: string };
  let airlineB: { id: string; code: string };

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = TEST_ACCESS_SECRET;
    process.env.JWT_REFRESH_SECRET = TEST_REFRESH_SECRET;
    process.env.COOKIE_SECURE = 'false';

    mongo = await MongoMemoryServer.create();
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [configuration],
        }),
        MongooseModule.forRoot(mongo.getUri()),
        AuthModule,
        AirlinesModule,
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    setupSwagger(app);
    await app.init();
    connection = app.get<Connection>(getConnectionToken());
    await connection.model('User').init();
    await connection.model('Airline').init(); // unique index on code

    admin = await loginAs('admin@example.com', { role: Role.ADMIN });
    user = await loginAs('user@example.com');

    // The admin creates two airlines through the API; moderators are then linked to them.
    airlineA = (
      await http()
        .post('/api/airlines')
        .set('Cookie', admin)
        .send({ name: 'Airline A', code: 'AA' })
        .expect(201)
    ).body;
    airlineB = (
      await http()
        .post('/api/airlines')
        .set('Cookie', admin)
        .send({ name: 'Airline B', code: 'BB' })
        .expect(201)
    ).body;
    modOfA = await loginAs('moda@example.com', {
      role: Role.AIRLINE_MODERATOR,
      airlineId: new Types.ObjectId(airlineA.id),
    });
    modOfB = await loginAs('modb@example.com', {
      role: Role.AIRLINE_MODERATOR,
      airlineId: new Types.ObjectId(airlineB.id),
    });
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
  });

  describe('POST /api/airlines', () => {
    it('admin creates an airline: 201, DTO with id, no _id/__v', async () => {
      const res = await http()
        .post('/api/airlines')
        .set('Cookie', admin)
        .send({
          name: '  EgyptAir ',
          code: 'ms',
          logoUrl: 'https://example.com/ms.png',
        })
        .expect(201);
      expect(res.body).toMatchObject({
        name: 'EgyptAir',
        code: 'MS',
        logoUrl: 'https://example.com/ms.png',
        isActive: true,
      });
      expect(res.body.id).toMatch(/^[0-9a-f]{24}$/);
      expect(res.body).not.toHaveProperty('_id');
      expect(res.body).not.toHaveProperty('__v');
    });

    it('an airline moderator gets 403', async () => {
      const res = await http()
        .post('/api/airlines')
        .set('Cookie', modOfA)
        .send({ name: 'Nope Air', code: 'NP' })
        .expect(403);
      expect(res.body).toMatchObject({ statusCode: 403, error: 'Forbidden' });
    });

    it('a normal user gets 403', async () => {
      await http()
        .post('/api/airlines')
        .set('Cookie', user)
        .send({ name: 'Nope Air', code: 'NP' })
        .expect(403);
    });

    it('no cookie gets 401', async () => {
      await http()
        .post('/api/airlines')
        .send({ name: 'Nope Air', code: 'NP' })
        .expect(401);
    });

    it('validates name, code and logo with field-level details', async () => {
      const res = await http()
        .post('/api/airlines')
        .set('Cookie', admin)
        .send({ name: 'A', code: 'TOOLONG', logoUrl: 'javascript:alert(1)' })
        .expect(400);
      const fields = res.body.details.map((d: { field: string }) => d.field);
      expect(fields).toEqual(
        expect.arrayContaining(['name', 'code', 'logoUrl']),
      );
    });

    it('rejects a missing name and code', async () => {
      const res = await http()
        .post('/api/airlines')
        .set('Cookie', admin)
        .send({})
        .expect(400);
      const fields = res.body.details.map((d: { field: string }) => d.field);
      expect(fields).toEqual(expect.arrayContaining(['name', 'code']));
    });

    it('rejects fields the client must not control (isActive, id, ...)', async () => {
      const res = await http()
        .post('/api/airlines')
        .set('Cookie', admin)
        .send({ name: 'Sneaky Air', code: 'SN', isActive: false, id: '1' })
        .expect(400);
      const fields = res.body.details.map((d: { field: string }) => d.field);
      expect(fields).toEqual(expect.arrayContaining(['isActive', 'id']));
    });

    it('a duplicate code (any case) is 409', async () => {
      const res = await http()
        .post('/api/airlines')
        .set('Cookie', admin)
        .send({ name: 'Copycat', code: 'aa' })
        .expect(409);
      expect(res.body.details).toEqual([
        { field: 'code', message: 'code already exists' },
      ]);
    });
  });

  describe('GET /api/airlines/:id', () => {
    it('any logged-in role can read a profile', async () => {
      for (const cookie of [admin, user, modOfA, modOfB]) {
        const res = await http()
          .get(`/api/airlines/${airlineA.id}`)
          .set('Cookie', cookie)
          .expect(200);
        expect(res.body).toMatchObject({
          id: airlineA.id,
          name: 'Airline A',
          code: 'AA',
        });
      }
    });

    it('no cookie gets 401', async () => {
      await http().get(`/api/airlines/${airlineA.id}`).expect(401);
    });

    it('unknown id is 404, malformed id is 400', async () => {
      await http()
        .get(`/api/airlines/${new Types.ObjectId()}`)
        .set('Cookie', admin)
        .expect(404);
      await http()
        .get('/api/airlines/not-an-id')
        .set('Cookie', admin)
        .expect(400);
    });
  });

  describe('PATCH /api/airlines/:id', () => {
    it('the moderator of that airline edits name, code and logo', async () => {
      const res = await http()
        .patch(`/api/airlines/${airlineA.id}`)
        .set('Cookie', modOfA)
        .send({
          name: 'Airline A Renamed',
          code: 'AX',
          logoUrl: 'https://example.com/a.png',
        })
        .expect(200);
      expect(res.body).toMatchObject({
        id: airlineA.id,
        name: 'Airline A Renamed',
        code: 'AX',
        logoUrl: 'https://example.com/a.png',
      });
    });

    it('a moderator editing ANOTHER airline gets 403 and nothing changes', async () => {
      await http()
        .patch(`/api/airlines/${airlineB.id}`)
        .set('Cookie', modOfA)
        .send({ name: 'Hijacked' })
        .expect(403);
      const res = await http()
        .get(`/api/airlines/${airlineB.id}`)
        .set('Cookie', admin)
        .expect(200);
      expect(res.body.name).toBe('Airline B');
    });

    it('an admin and a normal user get 403', async () => {
      await http()
        .patch(`/api/airlines/${airlineA.id}`)
        .set('Cookie', admin)
        .send({ name: 'Admin Edit' })
        .expect(403);
      await http()
        .patch(`/api/airlines/${airlineA.id}`)
        .set('Cookie', user)
        .send({ name: 'User Edit' })
        .expect(403);
    });

    it('no cookie gets 401', async () => {
      await http()
        .patch(`/api/airlines/${airlineA.id}`)
        .send({ name: 'Anon Edit' })
        .expect(401);
    });

    it('validates the fields it receives', async () => {
      const res = await http()
        .patch(`/api/airlines/${airlineB.id}`)
        .set('Cookie', modOfB)
        .send({ code: '!!', logoUrl: 'ftp://example.com/x.png' })
        .expect(400);
      const fields = res.body.details.map((d: { field: string }) => d.field);
      expect(fields).toEqual(expect.arrayContaining(['code', 'logoUrl']));
    });

    it('rejects isActive (only the Admin module may change it) and an empty body', async () => {
      await http()
        .patch(`/api/airlines/${airlineB.id}`)
        .set('Cookie', modOfB)
        .send({ isActive: false })
        .expect(400);
      const res = await http()
        .patch(`/api/airlines/${airlineB.id}`)
        .set('Cookie', modOfB)
        .send({})
        .expect(400);
      expect(res.body.message).toBe('Nothing to update');
    });

    it("changing the code to another airline's code is 409", async () => {
      await http()
        .patch(`/api/airlines/${airlineB.id}`)
        .set('Cookie', modOfB)
        .send({ code: 'AX' })
        .expect(409);
    });

    it('a malformed id is 400', async () => {
      await http()
        .patch('/api/airlines/not-an-id')
        .set('Cookie', modOfB)
        .send({ name: 'Whatever' })
        .expect(400);
    });
  });

  it('Swagger documents the three airline routes with cookie auth', async () => {
    const res = await http().get('/api/docs-json').expect(200);
    expect(res.body.paths['/api/airlines'].post).toBeDefined();
    expect(res.body.paths['/api/airlines/{id}'].get).toBeDefined();
    expect(res.body.paths['/api/airlines/{id}'].patch.security).toEqual([
      { cookie: [] },
    ]);
  });
});
