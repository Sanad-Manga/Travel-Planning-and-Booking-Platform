import { INestApplication, RequestMethod } from '@nestjs/common';
import {
  METHOD_METADATA,
  PATH_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { DiscoveryService, Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { getMetadataStorage } from 'class-validator';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { IS_PUBLIC_KEY } from '../src/common/decorators/public.decorator';
import { ROLES_KEY } from '../src/common/decorators/roles.decorator';
import { Role } from '../src/common/enums';
import { buildSwaggerDocument, setupApp } from '../src/setup-app';
import {
  TEST_ACCESS_SECRET,
  TEST_REFRESH_SECRET,
} from './helpers/auth-test-app';

/**
 * GEN-02: every endpoint with a body answers a bad body with the contract's error shape and ONE message per broken
 * field, so the frontend can show inline errors.
 *
 * Like guest-401 this reads every route of the running AppModule, so a module added later is covered without
 * editing this file. For each route that takes a body DTO it sends `{ __notAField: true }` (as the right role) and
 * checks, per module:
 *   - 400 with { statusCode, error, message: 'Validation failed', details[], path, timestamp };
 *   - every details entry is { field, message } with real text;
 *   - the unknown field is reported, and so is EVERY required property of the DTO (one entry per field, not just
 *     the first failure);
 * and that Swagger documents the 400 (with an example) on the same operations.
 */

type Handler = (...args: unknown[]) => unknown;
type Constructor = new (...args: never[]) => unknown;

interface BodyRoute {
  module: string; // controller class name
  method: RequestMethod;
  path: string; // /api/flights/:id/cabins
  isPublic: boolean;
  roles: Role[];
  bodyType: Constructor;
}

const METHOD_NAMES: Record<
  number,
  'post' | 'put' | 'patch' | 'delete' | 'get'
> = {
  [RequestMethod.GET]: 'get',
  [RequestMethod.POST]: 'post',
  [RequestMethod.PUT]: 'put',
  [RequestMethod.DELETE]: 'delete',
  [RequestMethod.PATCH]: 'patch',
};

const asArray = (p: unknown): string[] =>
  Array.isArray(p) ? (p as string[]) : [(p as string | undefined) ?? ''];

const joinPath = (...parts: string[]) =>
  '/' +
  parts
    .map((p) => p.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');

/** Properties a DTO requires: validated, and not made optional by @IsOptional / @ValidateIf. */
function requiredProperties(dto: Constructor): string[] {
  const metadata = getMetadataStorage().getTargetValidationMetadatas(
    dto,
    undefined as unknown as string,
    false,
    false,
  );
  const validated = new Set<string>();
  const optional = new Set<string>();
  for (const m of metadata) {
    validated.add(m.propertyName);
    if (m.type === 'conditionalValidation') optional.add(m.propertyName);
  }
  return [...validated].filter((p) => !optional.has(p));
}

describe('field-level validation messages on every module (GEN-02, whole app)', () => {
  let app: INestApplication;
  let mongo: MongoMemoryServer;
  let connection: Connection;
  let routes: BodyRoute[];
  const cookies: Partial<Record<Role, string>> = {};

  const http = () => request(app.getHttpServer());
  const jwt = new JwtService({ secret: TEST_ACCESS_SECRET });

  async function cookieFor(
    role: Role,
    extra: Record<string, unknown> = {},
  ): Promise<string> {
    const { insertedId } = await connection.collection('users').insertOne({
      name: `Validation ${role}`,
      email: `${role.toLowerCase()}@validation.test`,
      passwordHash: 'not-used',
      role,
      status: 'ACTIVE',
      consentAcceptedAt: new Date(),
      preferredCurrency: 'USD',
      createdAt: new Date(),
      updatedAt: new Date(),
      ...extra,
    });
    const token = await jwt.signAsync(
      { sub: insertedId.toHexString(), role, ...extra },
      { expiresIn: '10m' },
    );
    return `access_token=${token}`;
  }

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    // Set BEFORE AppModule is imported so nothing from backend/.env (e.g. the shared Atlas URI) can win.
    process.env.MONGODB_URI = mongo.getUri();
    process.env.JWT_ACCESS_SECRET = TEST_ACCESS_SECRET;
    process.env.JWT_REFRESH_SECRET = TEST_REFRESH_SECRET;
    process.env.COOKIE_SECURE = 'false';
    expect(process.env.MONGODB_URI).toMatch(/^mongodb:\/\/127\.0\.0\.1:/);

    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    connection = app.get<Connection>(getConnectionToken());

    cookies[Role.USER] = await cookieFor(Role.USER);
    cookies[Role.ADMIN] = await cookieFor(Role.ADMIN);
    cookies[Role.AIRLINE_MODERATOR] = await cookieFor(Role.AIRLINE_MODERATOR, {
      airlineId: new Types.ObjectId().toHexString(),
    });
    cookies[Role.HOTEL_MODERATOR] = await cookieFor(Role.HOTEL_MODERATOR, {
      hotelId: new Types.ObjectId().toHexString(),
    });

    const discovery = app.get(DiscoveryService);
    const reflector = app.get(Reflector);
    routes = [];
    for (const wrapper of discovery.getControllers()) {
      const controller = wrapper.metatype;
      if (!controller) continue;
      const basePaths = asArray(Reflect.getMetadata(PATH_METADATA, controller));
      const proto = controller.prototype as Record<string, unknown>;
      for (const name of Object.getOwnPropertyNames(proto)) {
        const handler = proto[name] as Handler;
        if (typeof handler !== 'function') continue;
        const method = Reflect.getMetadata(METHOD_METADATA, handler) as
          RequestMethod | undefined;
        if (method === undefined || !(method in METHOD_NAMES)) continue;

        // Which parameter is @Body(), and what class is it?
        const args = (Reflect.getMetadata(
          ROUTE_ARGS_METADATA,
          controller,
          name,
        ) ?? {}) as Record<string, { index: number }>;
        const bodyKey = Object.keys(args).find(
          (k) => Number(k.split(':')[0]) === RouteParamtypes.BODY,
        );
        if (!bodyKey) continue;
        const paramTypes = (Reflect.getMetadata(
          'design:paramtypes',
          proto,
          name,
        ) ?? []) as Constructor[];
        const bodyType = paramTypes[args[bodyKey].index];
        if (!bodyType || bodyType === Object) continue; // not a DTO class

        const isPublic = !!reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
          handler,
          controller,
        ]);
        const roles =
          reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
            handler,
            controller,
          ]) ?? [];
        for (const base of basePaths) {
          for (const sub of asArray(
            Reflect.getMetadata(PATH_METADATA, handler),
          )) {
            routes.push({
              module: controller.name,
              method,
              path: joinPath('api', base, sub),
              isPublic,
              roles,
              bodyType,
            });
          }
        }
      }
    }
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
  });

  it('finds the body routes of every module that takes a body (cannot pass vacuously)', () => {
    const modules = new Set(routes.map((r) => r.module));
    expect(routes.length).toBeGreaterThanOrEqual(15);
    for (const controller of [
      'AuthController',
      'UsersController',
      'AirlinesController',
      'FlightsController',
      'FlightCabinsController',
      'HotelsController',
      'RoomsController',
      'ItinerariesController',
      'BlogController',
    ]) {
      expect(modules).toContain(controller);
    }
  });

  describe('a bad body returns one message per field in the contract error shape', () => {
    const modulesSeen = (): string[] => [
      ...new Set(routes.map((r) => r.module)),
    ];

    it('every body route of every module', async () => {
      const failures: string[] = [];
      for (const route of routes) {
        const concrete = route.path.replace(/:[A-Za-z0-9_]+/g, () =>
          new Types.ObjectId().toHexString(),
        );
        const cookie = route.isPublic
          ? undefined
          : cookies[route.roles[0] ?? Role.USER];
        const call = http()[METHOD_NAMES[route.method]](concrete);
        if (cookie) call.set('Cookie', cookie);
        const res = await call.send({ __notAField: true });
        const label = `${route.module} ${METHOD_NAMES[route.method].toUpperCase()} ${route.path}`;

        const problems: string[] = [];
        if (res.status !== 400) problems.push(`status ${res.status}`);
        const body = res.body as {
          statusCode?: number;
          error?: string;
          message?: string;
          details?: { field?: unknown; message?: unknown }[];
          path?: string;
          timestamp?: string;
        };
        if (body.statusCode !== 400) problems.push('statusCode');
        if (body.error !== 'Bad Request') problems.push('error');
        if (body.message !== 'Validation failed') problems.push('message');
        if (body.path !== concrete) problems.push('path');
        if (!/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(body.timestamp ?? ''))
          problems.push('timestamp');
        const details = Array.isArray(body.details) ? body.details : [];
        if (details.length === 0) problems.push('no details');
        for (const d of details) {
          if (
            typeof d.field !== 'string' ||
            d.field.length === 0 ||
            typeof d.message !== 'string' ||
            d.message.length === 0
          ) {
            problems.push(`bad detail ${JSON.stringify(d)}`);
          }
        }
        const fields = details.map((d) => d.field);
        if (!fields.includes('__notAField'))
          problems.push('unknown field not reported');
        for (const required of requiredProperties(route.bodyType)) {
          if (!fields.includes(required)) {
            problems.push(`required "${required}" has no message`);
          }
        }
        if (problems.length > 0)
          failures.push(`${label}: ${problems.join(', ')}`);
      }
      expect(failures).toEqual([]);
    }, 180_000);

    it('reports each module separately so a failure names the module', () => {
      // The sweep above lists "<Controller> <METHOD> <path>" for every failing route; this guards the grouping.
      expect(modulesSeen().length).toBeGreaterThanOrEqual(9);
    });
  });

  describe('Swagger documents the 400 with an example', () => {
    it('every operation that takes a body has a 400 response with an example', () => {
      const document = buildSwaggerDocument(app);
      const missing: string[] = [];
      for (const route of routes) {
        const swaggerPath = route.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
        const operation =
          document.paths[swaggerPath]?.[METHOD_NAMES[route.method]];
        const response = operation?.responses?.['400'] as
          | {
              content?: Record<
                string,
                { example?: unknown; examples?: unknown; schema?: unknown }
              >;
            }
          | undefined;
        const content = response?.content?.['application/json'];
        const hasExample =
          !!content &&
          (content.example !== undefined ||
            content.examples !== undefined ||
            content.schema !== undefined); // the ErrorResponseDto schema carries example values
        if (!response || !hasExample) {
          missing.push(
            `${METHOD_NAMES[route.method].toUpperCase()} ${swaggerPath}`,
          );
        }
      }
      expect(missing).toEqual([]);
    });

    it('the default 400 added for undocumented routes carries the field-level example', () => {
      const document = buildSwaggerDocument(app);
      const defaults = Object.values(document.paths)
        .flatMap((item) => Object.values(item))
        .map(
          (op) =>
            (op as { responses?: Record<string, unknown> }).responses?.['400'],
        )
        .filter(Boolean) as Array<{
        content?: {
          'application/json'?: { example?: { details?: unknown[] } };
        };
      }>;
      expect(defaults.length).toBeGreaterThan(0);
      const withExample = defaults.filter(
        (r) => r.content?.['application/json']?.example?.details,
      );
      expect(withExample.length).toBeGreaterThan(0);
      expect(
        withExample[0].content!['application/json']!.example!.details,
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'email',
            message: expect.any(String),
          }),
        ]),
      );
    });
  });
});
