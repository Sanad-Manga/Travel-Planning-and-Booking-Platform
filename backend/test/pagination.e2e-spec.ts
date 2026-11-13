import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getConnectionToken } from '@nestjs/mongoose';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { PostStatus, Role, Visibility } from '../src/common';
import { setupApp } from '../src/setup-app';
import {
  TEST_ACCESS_SECRET,
  TEST_REFRESH_SECRET,
} from './helpers/auth-test-app';

/**
 * GEN-05: every list endpoint takes `page` and `limit` (default 10, max 50) and answers
 * `{ items, page, limit, total, totalPages }` (docs/contracts.md section 3).
 *
 * Whole app, over HTTP. The list of endpoints is NOT hand-written only: the completeness test reads the Swagger
 * document and fails when a GET route takes `page`/`limit` and is missing from the table below, or when any GET
 * answers with a bare array. So a new list endpoint cannot ship without being added here.
 */

type Auth = 'none' | 'user' | 'admin';
interface ListRoute {
  /** Swagger-style path, e.g. /api/tags/{tag}/posts */
  swagger: string;
  /** The real URL to call, without the query string. */
  url: string;
  auth: Auth;
  /** Fixed query parameters the endpoint needs (besides page and limit). */
  query?: string;
  /** Rows seeded for this endpoint; undefined = the endpoint cannot be seeded cheaply (envelope and limits only). */
  total?: number;
}

describe('pagination on every list endpoint (GEN-05, whole app)', () => {
  let app: INestApplication;
  let mongo: MongoMemoryServer;
  let db: Connection;
  const jwt = new JwtService({ secret: TEST_ACCESS_SECRET });
  const cookies: Record<'user' | 'admin', string> = { user: '', admin: '' };
  let userId: Types.ObjectId;

  async function account(
    role: Role,
  ): Promise<{ id: Types.ObjectId; cookie: string }> {
    const _id = new Types.ObjectId();
    await db.collection('users').insertOne({
      _id,
      name: 'Pager',
      email: `${_id.toHexString()}@paging.test`,
      passwordHash: 'x',
      role,
      status: 'ACTIVE',
      consentAcceptedAt: new Date(),
      preferredCurrency: 'USD',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const token = await jwt.signAsync(
      { sub: _id.toHexString(), role },
      { expiresIn: '30m' },
    );
    return { id: _id, cookie: `access_token=${token}` };
  }

  const rows = (n: number, make: (i: number) => object) =>
    Array.from({ length: n }, (_v, i) => make(i));
  const now = new Date();

  /** The post whose comments the /api/posts/{id}/comments row pages through. */
  const commentedPostId = new Types.ObjectId();

  /**
   * GETs that take page and limit but are NOT lists. The post page pages only its embedded first batch of
   * comments; the real comment list is /api/posts/{id}/comments, which is in the table above.
   */
  const NOT_LISTS = ['/api/posts/{id}'];

  const ROUTES: ListRoute[] = [
    { swagger: '/api/admin/accounts', url: '/api/admin/accounts', auth: 'admin', total: 2 },
    // 25 plain posts + the one post that carries the comments below
    { swagger: '/api/posts', url: '/api/posts', auth: 'none', total: 26 },
    {
      swagger: '/api/posts/mine',
      url: '/api/posts/mine',
      auth: 'user',
      total: 25,
    },
    {
      swagger: '/api/posts/{id}/comments',
      url: `/api/posts/${commentedPostId.toHexString()}/comments`,
      auth: 'user',
      total: 25,
    },
    {
      swagger: '/api/tags/{tag}/posts',
      url: '/api/tags/cairo/posts',
      auth: 'none',
      total: 25,
    },
    // 25 seeded + the two the flight search test needs (CAI, JFK)
    { swagger: '/api/airports', url: '/api/airports', auth: 'none', total: 27 },
    {
      swagger: '/api/notifications',
      url: '/api/notifications',
      auth: 'user',
      total: 25,
    },
    {
      swagger: '/api/itineraries/public/search',
      url: '/api/itineraries/public/search',
      auth: 'none',
      total: 25,
    },
    {
      swagger: '/api/itineraries',
      url: '/api/itineraries',
      auth: 'user',
      total: 25,
    },
    {
      swagger: '/api/admin/audit-logs',
      url: '/api/admin/audit-logs',
      auth: 'admin',
      total: 25,
    },
    {
      swagger: '/api/flights/search',
      url: '/api/flights/search',
      auth: 'none',
      query:
        'departureAirport=CAI&arrivalAirport=JFK&departureDate=2026-12-01&passengers=1',
      // flights need airlines + cabins; their paging is proven with data in flights-search.e2e-spec.ts
    },
  ];

  const get = (route: ListRoute, params: string) => {
    const qs = [route.query, params].filter(Boolean).join('&');
    const r = request(app.getHttpServer()).get(
      `${route.url}${qs ? `?${qs}` : ''}`,
    );
    if (route.auth !== 'none') r.set('Cookie', cookies[route.auth]);
    return r;
  };

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    // Set BEFORE AppModule is imported so nothing from backend/.env can win.
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
    db = app.get<Connection>(getConnectionToken());

    const user = await account(Role.USER);
    const admin = await account(Role.ADMIN);
    cookies.user = user.cookie;
    cookies.admin = admin.cookie;
    userId = user.id;

    await db.collection('posts').insertMany(
      rows(25, (i) => ({
        authorId: userId,
        title: `Post ${i}`,
        body: 'Body',
        tags: ['cairo'],
        images: [],
        status: PostStatus.PUBLISHED,
        publishedAt: new Date(now.getTime() - i * 1000),
        isHidden: false,
        likeCount: 0,
        commentCount: 0,
        createdAt: now,
        updatedAt: now,
      })),
    );
    await db.collection('posts').insertOne({
      _id: commentedPostId,
      authorId: admin.id,
      title: 'Post with comments',
      body: 'Body',
      tags: ['commented'],
      images: [],
      status: PostStatus.PUBLISHED,
      publishedAt: now,
      isHidden: false,
      likeCount: 0,
      commentCount: 25,
      createdAt: now,
      updatedAt: now,
    });
    await db.collection('comments').insertMany(
      rows(25, (i) => ({
        postId: commentedPostId,
        authorId: userId,
        body: `Comment ${i}`,
        isHidden: false,
        createdAt: new Date(now.getTime() + i * 1000),
        updatedAt: now,
      })),
    );
    await db.collection('itineraries').insertMany(
      rows(25, (i) => ({
        authorId: userId,
        title: `Trip ${i}`,
        countryCodes: ['EG'],
        visibility: Visibility.PUBLIC,
        isHidden: false,
        days: [],
        createdAt: now,
        updatedAt: new Date(now.getTime() - i * 1000),
      })),
    );
    await db.collection('notifications').insertMany(
      rows(25, (i) => ({
        userId,
        type: 'BOOKING_CONFIRMED',
        title: `Title ${i}`,
        message: `Message ${i}`,
        isRead: false,
        createdAt: new Date(now.getTime() - i * 1000),
        updatedAt: now,
      })),
    );
    await db.collection('auditLogs').insertMany(
      rows(25, (i) => ({
        actorId: admin.id.toHexString(),
        action: 'TEST',
        targetType: 'USER',
        targetId: `t${i}`,
        createdAt: new Date(now.getTime() - i * 1000),
        updatedAt: now,
      })),
    );
    const airport = (code: string, i: number) => ({
      iata_code: code,
      name: `Airport ${code}`,
      city_id: `city-${i}`,
      country_code: 'EG',
      time_zone: 'Africa/Cairo',
      createdAt: now,
      updatedAt: now,
    });
    const codes = Array.from(
      { length: 25 },
      (_v, i) =>
        `A${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))}`,
    );
    await db.collection('countries').insertOne({
      code: 'EG',
      name: 'Egypt',
      currency: 'EGP',
      createdAt: now,
      updatedAt: now,
    });
    await db.collection('cities').insertMany(
      Array.from({ length: 100 }, (_v, i) => ({
        city_id: `city-${i}`,
        name: `City ${i}`,
        country_code: 'EG',
        createdAt: now,
        updatedAt: now,
      })),
    );
    await db
      .collection('airports')
      .insertMany([
        ...codes.map((c, i) => airport(c, i)),
        airport('CAI', 90),
        airport('JFK', 91),
      ]);
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
  });

  describe('completeness: no list ships without paging', () => {
    const operations = () => {
      const doc = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().build(),
      );
      return Object.entries(doc.paths).flatMap(([path, item]) =>
        item.get ? [{ path, op: item.get }] : [],
      );
    };

    it('every GET that takes page and limit is in the table above', () => {
      const paged = operations()
        .filter(({ op }) => {
          const names = (op.parameters ?? []).map((p) =>
            'name' in p ? p.name : '',
          );
          return names.includes('page') && names.includes('limit');
        })
        .map(({ path }) => path)
        .filter((path) => !NOT_LISTS.includes(path))
        .sort();
      expect(paged).toEqual(ROUTES.map((r) => r.swagger).sort());
    });

    it('no GET endpoint answers with a bare array (a list must be paginated)', () => {
      const arrays = operations()
        .filter(({ op }) => {
          const ok = op.responses?.['200'] as
            | { content?: Record<string, { schema?: { type?: string } }> }
            | undefined;
          return ok?.content?.['application/json']?.schema?.type === 'array';
        })
        .map(({ path }) => path);
      expect(arrays).toEqual([]);
    });

    it('limit is documented as min 1, max 50, default 10 and page as min 1, default 1 on every list', () => {
      for (const route of ROUTES) {
        const op = operations().find((o) => o.path === route.swagger)!.op;
        const param = (name: string) =>
          (op.parameters ?? []).find((p) => 'name' in p && p.name === name) as {
            schema: { minimum?: number; maximum?: number; default?: number };
          };
        expect({
          route: route.swagger,
          ...param('limit').schema,
        }).toMatchObject({ minimum: 1, maximum: 50, default: 10 });
        expect({ route: route.swagger, ...param('page').schema }).toMatchObject(
          { minimum: 1, default: 1 },
        );
      }
    });

    it('the paginated 200 schema lists items, page, limit, total and totalPages', () => {
      for (const route of ROUTES) {
        const op = operations().find((o) => o.path === route.swagger)!.op;
        const ok = op.responses?.['200'] as {
          content?: Record<
            string,
            { schema?: { properties?: object; $ref?: string } }
          >;
        };
        const schema = ok.content?.['application/json']?.schema;
        const doc = SwaggerModule.createDocument(
          app,
          new DocumentBuilder().build(),
        );
        const resolved = schema?.$ref
          ? (doc.components!.schemas![schema.$ref.split('/').pop()!] as {
              properties?: object;
            })
          : schema;
        expect({
          route: route.swagger,
          keys: Object.keys(resolved?.properties ?? {}).sort(),
        }).toEqual({
          route: route.swagger,
          keys: ['items', 'limit', 'page', 'total', 'totalPages'],
        });
      }
    });
  });

  describe.each(ROUTES.map((r) => [r.swagger, r] as const))(
    '%s',
    (_name, route) => {
      it('defaults to page 1, limit 10 and returns exactly the contract envelope', async () => {
        const res = await get(route, '');
        expect(res.status).toBe(200);
        expect(Object.keys(res.body as object).sort()).toEqual([
          'items',
          'limit',
          'page',
          'total',
          'totalPages',
        ]);
        const body = res.body as {
          items: unknown[];
          page: number;
          limit: number;
          total: number;
          totalPages: number;
        };
        expect(body.page).toBe(1);
        expect(body.limit).toBe(10);
        expect(Array.isArray(body.items)).toBe(true);
        expect(body.items.length).toBeLessThanOrEqual(10);
        expect(body.totalPages).toBe(
          body.total === 0 ? 0 : Math.ceil(body.total / 10),
        );
      });

      it('limit 1 and limit 50 are accepted and echoed', async () => {
        for (const limit of [1, 50]) {
          const res = await get(route, `limit=${limit}`);
          expect(res.status).toBe(200);
          expect((res.body as { limit: number }).limit).toBe(limit);
          expect(
            (res.body as { items: unknown[] }).items.length,
          ).toBeLessThanOrEqual(limit);
        }
      });

      it.each([
        ['limit=51', 'limit'],
        ['limit=0', 'limit'],
        ['limit=-1', 'limit'],
        ['limit=2.5', 'limit'],
        ['limit=abc', 'limit'],
        ['page=0', 'page'],
        ['page=-3', 'page'],
        ['page=abc', 'page'],
        ['page=1.5', 'page'],
      ])('%s is a field-level 400', async (params, field) => {
        const res = await get(route, params);
        expect(res.status).toBe(400);
        expect(
          (res.body as { details: { field: string }[] }).details.map(
            (d) => d.field,
          ),
        ).toContain(field);
      });

      it('a page past the end is an empty list, not an error', async () => {
        for (const page of [100, 999999]) {
          const res = await get(route, `page=${page}`);
          expect(res.status).toBe(200);
          const body = res.body as {
            items: unknown[];
            page: number;
            total: number;
            totalPages: number;
          };
          expect(body.items).toEqual([]);
          expect(body.page).toBe(page);
          expect(body.totalPages).toBe(
            body.total === 0 ? 0 : Math.ceil(body.total / 10),
          );
        }
      });

      if (route.total !== undefined) {
        const total = route.total;
        const pages = Math.ceil(total / 10);

        it(`pages the ${total} seeded rows: ${pages} pages of 10, no row twice, none missing`, async () => {
          const seen: string[] = [];
          for (let page = 1; page <= pages; page++) {
            const res = await get(route, `page=${page}`);
            expect(res.status).toBe(200);
            const body = res.body as {
              items: unknown[];
              total: number;
              totalPages: number;
            };
            expect(body.total).toBe(total);
            expect(body.totalPages).toBe(pages);
            expect(body.items).toHaveLength(
              page < pages ? 10 : total - 10 * (pages - 1),
            );
            seen.push(...body.items.map((i) => JSON.stringify(i)));
          }
          expect(new Set(seen).size).toBe(total);
          // one page past the end
          const past = await get(route, `page=${pages + 1}`);
          expect(
            (past.body as { items: unknown[]; total: number }).items,
          ).toEqual([]);
          expect((past.body as { total: number }).total).toBe(total);
        });

        it('limit 50 returns every seeded row on one page', async () => {
          const res = await get(route, 'limit=50');
          const body = res.body as { items: unknown[]; totalPages: number };
          expect(body.items).toHaveLength(total);
          expect(body.totalPages).toBe(1);
        });
      }
    },
  );

  it('a guest cannot read the lists that need a login (401, not an empty page)', async () => {
    for (const route of ROUTES.filter((r) => r.auth !== 'none')) {
      const res = await request(app.getHttpServer()).get(route.url);
      expect(res.status).toBe(401);
    }
  });
});
