import {
  INestApplication,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { Role } from '../common';
import { setupApp } from '../setup-app';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

const USER_ID = '674a1b2c3d4e5f6a7b8c9d00';
const NOTIFICATION_ID = '674a1b2c3d4e5f6a7b8c9d0e';
const AS_USER = { 'x-test-user': USER_ID };

describe('NotificationsController (HTTP, with the real pipe and error filter)', () => {
  let app: INestApplication;
  const service = {
    list: jest.fn(),
    unreadCount: jest.fn(),
    markRead: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [{ provide: NotificationsService, useValue: service }],
    }).compile();
    app = moduleRef.createNestApplication();
    // Test-only stand-in for the real JwtAuthGuard: a header pretends to be a logged-in
    // user, and a missing header rejects exactly like the real guard does (no cookie -> 401),
    // since this isolated controller test never registers the real global guard.
    app.use((req: Request, _res: Response, next: NextFunction) => {
      const userId = req.header('x-test-user');
      if (!userId) {
        next(new UnauthorizedException('Authentication required'));
        return;
      }
      Object.assign(req, { user: { userId, role: Role.USER } });
      next();
    });
    setupApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('documents the three endpoints in Swagger', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().build(),
    );

    expect(Object.keys(document.paths).sort()).toEqual([
      '/api/notifications',
      '/api/notifications/unread-count',
      '/api/notifications/{id}/read',
    ]);
    expect(document.paths['/api/notifications'].get?.tags).toEqual([
      'notifications',
    ]);
    expect(
      document.paths['/api/notifications/{id}/read'].patch?.responses,
    ).toHaveProperty('404');
  });

  describe('without a logged-in user', () => {
    it.each([
      ['GET', '/api/notifications'],
      ['GET', '/api/notifications/unread-count'],
      ['PATCH', `/api/notifications/${NOTIFICATION_ID}/read`],
    ])('%s %s answers 401 in the contract error shape', async (method, url) => {
      const res = await request(app.getHttpServer())[
        method.toLowerCase() as 'get' | 'patch'
      ](url);

      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({
        statusCode: 401,
        error: 'Unauthorized',
        path: url,
      });
      expect(service.list).not.toHaveBeenCalled();
      expect(service.unreadCount).not.toHaveBeenCalled();
      expect(service.markRead).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/notifications', () => {
    const envelope = { items: [], page: 1, limit: 10, total: 0, totalPages: 0 };

    it('lists with the default page and limit and passes the logged-in user', async () => {
      service.list.mockResolvedValue(envelope);

      const res = await request(app.getHttpServer())
        .get('/api/notifications')
        .set(AS_USER);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(envelope);
      expect(service.list).toHaveBeenCalledWith(
        { userId: USER_ID, role: Role.USER },
        expect.objectContaining({ page: 1, limit: 10 }),
      );
      expect(service.list.mock.calls[0][1].isRead).toBeUndefined();
    });

    it.each([
      ['false', false],
      ['true', true],
    ])(
      'turns isRead=%s into the boolean %s (not just "truthy text")',
      async (text, expected) => {
        service.list.mockResolvedValue(envelope);

        const res = await request(app.getHttpServer())
          .get(`/api/notifications?isRead=${text}`)
          .set(AS_USER);

        expect(res.status).toBe(200);
        expect(service.list.mock.calls[0][1].isRead).toBe(expected);
      },
    );

    it.each(['isRead=maybe', 'limit=51', 'page=0', 'limit=abc', 'unknown=1'])(
      'rejects ?%s with 400 and field details',
      async (qs) => {
        const res = await request(app.getHttpServer())
          .get(`/api/notifications?${qs}`)
          .set(AS_USER);

        expect(res.status).toBe(400);
        expect(res.body).toMatchObject({
          statusCode: 400,
          message: 'Validation failed',
        });
        expect(res.body.details.length).toBeGreaterThan(0);
        expect(service.list).not.toHaveBeenCalled();
      },
    );
  });

  describe('GET /api/notifications/unread-count', () => {
    it('returns the count for the logged-in user', async () => {
      service.unreadCount.mockResolvedValue({ unreadCount: 3 });

      const res = await request(app.getHttpServer())
        .get('/api/notifications/unread-count')
        .set(AS_USER);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ unreadCount: 3 });
      expect(service.unreadCount).toHaveBeenCalledWith({
        userId: USER_ID,
        role: Role.USER,
      });
    });
  });

  describe('PATCH /api/notifications/:id/read', () => {
    it('marks the notification read for the logged-in user', async () => {
      service.markRead.mockResolvedValue({ id: NOTIFICATION_ID, isRead: true });

      const res = await request(app.getHttpServer())
        .patch(`/api/notifications/${NOTIFICATION_ID}/read`)
        .set(AS_USER);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ id: NOTIFICATION_ID, isRead: true });
      expect(service.markRead).toHaveBeenCalledWith(
        { userId: USER_ID, role: Role.USER },
        NOTIFICATION_ID,
      );
    });

    it('rejects an id that is not a valid id with 400', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/notifications/not-an-id/read')
        .set(AS_USER);

      expect(res.status).toBe(400);
      expect(res.body.details).toEqual([
        expect.objectContaining({ field: 'id' }),
      ]);
      expect(service.markRead).not.toHaveBeenCalled();
    });

    it('answers 404 in the contract shape when the service says it is not theirs or missing', async () => {
      service.markRead.mockRejectedValue(
        new NotFoundException('Notification not found'),
      );

      const res = await request(app.getHttpServer())
        .patch(`/api/notifications/${NOTIFICATION_ID}/read`)
        .set(AS_USER);

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({
        statusCode: 404,
        error: 'Not Found',
        message: 'Notification not found',
        path: `/api/notifications/${NOTIFICATION_ID}/read`,
      });
    });
  });
});
