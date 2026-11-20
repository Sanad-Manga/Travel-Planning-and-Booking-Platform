import { INestApplication, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryService, Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { hashSync } from 'bcryptjs';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { Role } from '../src/common/enums';
import { IS_PUBLIC_KEY } from '../src/common/decorators/public.decorator';
import { setupApp } from '../src/setup-app';
import {
  TEST_ACCESS_SECRET,
  TEST_REFRESH_SECRET,
} from './helpers/auth-test-app';

/**
 * ACC-10: a guest who hits a restricted action always gets the same 401 so the frontend can redirect to login.
 * The behaviour comes from the global JwtAuthGuard + AllExceptionsFilter; this spec proves it for the WHOLE app
 * by reading every route of the running AppModule, so routes added later are covered without editing this file.
 */

interface RouteInfo {
  method: RequestMethod;
  path: string; // e.g. /api/itineraries/:id
  isPublic: boolean;
}

const METHOD_NAMES: Record<number, string> = {
  [RequestMethod.GET]: 'get',
  [RequestMethod.POST]: 'post',
  [RequestMethod.PUT]: 'put',
  [RequestMethod.DELETE]: 'delete',
  [RequestMethod.PATCH]: 'patch',
};

const asArray = (p: unknown): string[] =>
  Array.isArray(p) ? (p as string[]) : [(p as string | undefined) ?? ''];

function joinPath(...parts: string[]): string {
  return (
    '/' +
    parts
      .map((p) => p.replace(/^\/+|\/+$/g, ''))
      .filter(Boolean)
      .join('/')
  );
}

describe('guest restricted actions return 401 (ACC-10, whole app)', () => {
  let app: INestApplication;
  let mongo: MongoMemoryServer;
  let connection: Connection;
  let routes: RouteInfo[];

  const http = () => request(app.getHttpServer());
  const accessJwt = new JwtService({ secret: TEST_ACCESS_SECRET });

  function expectStandard401(res: request.Response, path: string): void {
    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      statusCode: 401,
      error: 'Unauthorized',
      message: expect.any(String),
      path,
      timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/),
    });
  }

  function send(route: RouteInfo, cookie?: string) {
    const concrete = route.path.replace(/:[A-Za-z0-9_]+/g, () =>
      new Types.ObjectId().toHexString(),
    );
    const call = http()[METHOD_NAMES[route.method] as 'get'](concrete);
    if (cookie) call.set('Cookie', cookie);
    if (
      route.method === RequestMethod.POST ||
      route.method === RequestMethod.PUT ||
      route.method === RequestMethod.PATCH
    ) {
      call.send({});
    }
    return { call, concrete };
  }

  async function insertUser(email: string, status = 'ACTIVE'): Promise<string> {
    const { insertedId } = await connection.collection('users').insertOne({
      name: 'Guest Test',
      email,
      passwordHash: hashSync('Passw0rdOK', 4),
      role: Role.USER,
      status,
      consentAcceptedAt: new Date(),
      preferredCurrency: 'USD',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return insertedId.toHexString();
  }

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    // Set BEFORE AppModule is imported: constants.ts / ConfigModule only fill variables that are still unset,
    // so nothing from backend/.env (for example the shared Atlas URI) can win over the in-memory server.
    process.env.MONGODB_URI = mongo.getUri();
    process.env.JWT_ACCESS_SECRET = TEST_ACCESS_SECRET;
    process.env.JWT_REFRESH_SECRET = TEST_REFRESH_SECRET;
    process.env.COOKIE_SECURE = 'false';
    expect(process.env.MONGODB_URI).toMatch(/^mongodb:\/\/127\.0\.0\.1:/); // never the shared Atlas database

    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    connection = app.get<Connection>(getConnectionToken());
    await connection.model('User').init();

    // Enumerate every controller route and its @Public() flag, the same way the guard reads it.
    const discovery = app.get(DiscoveryService);
    const reflector = app.get(Reflector);
    routes = [];
    for (const wrapper of discovery.getControllers()) {
      const controller = wrapper.metatype;
      if (!controller) continue;
      const basePaths = asArray(Reflect.getMetadata(PATH_METADATA, controller));
      const proto = controller.prototype as Record<string, unknown>;
      for (const name of Object.getOwnPropertyNames(proto)) {
        const handler = proto[name];
        if (typeof handler !== 'function') continue;
        const method = Reflect.getMetadata(METHOD_METADATA, handler) as
          RequestMethod | undefined;
        if (method === undefined || !(method in METHOD_NAMES)) continue;
        const isPublic = !!reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
          handler,
          controller,
        ]);
        for (const base of basePaths) {
          for (const sub of asArray(
            Reflect.getMetadata(PATH_METADATA, handler),
          )) {
            routes.push({ method, path: joinPath('api', base, sub), isPublic });
          }
        }
      }
    }
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
  });

  describe('sweep of every registered route without a cookie', () => {
    it('finds a sensible number of routes (cannot pass vacuously)', () => {
      const protectedRoutes = routes.filter((r) => !r.isPublic);
      expect(routes.length).toBeGreaterThanOrEqual(15);
      expect(protectedRoutes.length).toBeGreaterThanOrEqual(10);
      expect(routes.some((r) => r.isPublic)).toBe(true);
    });

    it('covers the book / review / post style routes that exist on develop', () => {
      const protectedPaths = routes
        .filter((r) => !r.isPublic)
        .map((r) => `${METHOD_NAMES[r.method].toUpperCase()} ${r.path}`);
      for (const expected of [
        'POST /api/itineraries',
        'POST /api/posts',
        'GET /api/notifications',
        'GET /api/auth/me',
      ]) {
        expect(protectedPaths).toContain(expected);
      }
    });

    it('every non-@Public route answers a guest with 401 and the standard error body', async () => {
      const failures: string[] = [];
      for (const route of routes.filter((r) => !r.isPublic)) {
        const { call, concrete } = send(route);
        const res = await call;
        try {
          expectStandard401(res, concrete);
        } catch {
          failures.push(
            `${METHOD_NAMES[route.method].toUpperCase()} ${route.path} -> ${res.status} ${JSON.stringify(res.body)}`,
          );
        }
      }
      expect(failures).toEqual([]);
    }, 120_000);

    it('@Public routes are not blocked by the guard (anything but 401 for a guest)', async () => {
      const publicRoutes = routes.filter((r) => r.isPublic);
      const blocked: string[] = [];
      for (const route of publicRoutes) {
        const res = await send(route).call;
        // POST /api/auth/refresh is @Public but answers 401 itself: its own refresh-cookie check, not the guard.
        if (res.status === 401 && !route.path.endsWith('/auth/refresh'))
          blocked.push(`${route.method} ${route.path}`);
      }
      expect(blocked).toEqual([]);
    }, 120_000);
  });

  describe('bad credentials give the same 401 shape', () => {
    const route: RouteInfo = {
      method: RequestMethod.GET,
      path: '/api/auth/me',
      isPublic: false,
    };

    it('garbage access cookie', async () => {
      expectStandard401(
        await send(route, 'access_token=not-a-jwt').call,
        '/api/auth/me',
      );
    });

    it('empty access cookie', async () => {
      expectStandard401(
        await send(route, 'access_token=').call,
        '/api/auth/me',
      );
    });

    it('tampered token (valid payload, wrong signature)', async () => {
      const id = await insertUser('tampered@example.com');
      const good = await accessJwt.signAsync(
        { sub: id, role: Role.USER },
        { expiresIn: '5m' },
      );
      const [h, p, s] = good.split('.');
      const tampered = `${h}.${p}.${s.slice(0, -2)}${s.endsWith('AA') ? 'BB' : 'AA'}`;
      expectStandard401(
        await send(route, `access_token=${tampered}`).call,
        '/api/auth/me',
      );
    });

    it('token signed with another secret', async () => {
      const id = await insertUser('forged@example.com');
      const forged = await new JwtService({
        secret: 'some-other-secret-that-is-long-enough-123',
      }).signAsync({ sub: id, role: Role.USER });
      expectStandard401(
        await send(route, `access_token=${forged}`).call,
        '/api/auth/me',
      );
    });

    it('expired access token', async () => {
      const id = await insertUser('expired@example.com');
      const expired = await accessJwt.signAsync(
        { sub: id, role: Role.USER },
        { expiresIn: -10 },
      );
      expectStandard401(
        await send(route, `access_token=${expired}`).call,
        '/api/auth/me',
      );
    });

    it('a protected write route gives the same 401 for an expired token', async () => {
      const id = await insertUser('expired2@example.com');
      const expired = await accessJwt.signAsync(
        { sub: id, role: Role.USER },
        { expiresIn: -10 },
      );
      const res = await http()
        .post('/api/itineraries')
        .set('Cookie', `access_token=${expired}`)
        .send({});
      expectStandard401(res, '/api/itineraries');
    });

    it.each(['SUSPENDED', 'DEACTIVATED'])(
      '%s user with an otherwise valid cookie',
      async (status) => {
        const id = await insertUser(`${status.toLowerCase()}@example.com`);
        const cookie = `access_token=${await accessJwt.signAsync({ sub: id, role: Role.USER }, { expiresIn: '5m' })}`;
        await http().get('/api/auth/me').set('Cookie', cookie).expect(200); // works while ACTIVE
        await connection
          .collection('users')
          .updateOne({ _id: new Types.ObjectId(id) }, { $set: { status } });
        expectStandard401(await send(route, cookie).call, '/api/auth/me');
        expectStandard401(
          await http().post('/api/itineraries').set('Cookie', cookie).send({}),
          '/api/itineraries',
        );
      },
    );

    it('a valid token for a user that does not exist', async () => {
      const ghost = await accessJwt.signAsync(
        { sub: new Types.ObjectId().toHexString(), role: Role.USER },
        { expiresIn: '5m' },
      );
      expectStandard401(
        await send(route, `access_token=${ghost}`).call,
        '/api/auth/me',
      );
    });
  });

  describe('known @Public routes stay open for guests', () => {
    it('POST /api/auth/register with an empty body -> 400, not 401', async () => {
      const res = await http().post('/api/auth/register').send({});
      expect(res.status).toBe(400);
    });

    it('POST /api/auth/login with an empty body -> 400, not 401', async () => {
      const res = await http().post('/api/auth/login').send({});
      expect(res.status).toBe(400);
    });

    it('POST /api/auth/refresh without a cookie is answered by its own check (401 "Invalid or expired session")', async () => {
      const res = await http().post('/api/auth/refresh').send({});
      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Invalid or expired session');
    });

    it('GET /api/airports is open to guests', async () => {
      const res = await http().get('/api/airports');
      expect(res.status).toBe(200);
    });

    it('flight search is open to guests (the guard lets it through, validation answers 400)', async () => {
      const res = await http().get('/api/flights/search');
      expect(res.status).not.toBe(401);
    });
  });
});
