import { getConnectionToken, getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Connection, Model, Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { AuthenticatedUser, NotificationType, Role } from '../common';
import { NotificationsModule } from './notifications.module';
import { NotificationsService } from './notifications.service';
import { Notification } from './schemas/notification.schema';

jest.setTimeout(60000);

describe('NotificationsService with an isolated MongoDB', () => {
  let server: MongoMemoryServer;
  let moduleRef: TestingModule;
  let connection: Connection;
  let model: Model<Notification>;
  let service: NotificationsService;

  const userId = new Types.ObjectId().toString();
  const user: AuthenticatedUser = { userId, role: Role.USER };
  const otherUserId = new Types.ObjectId().toString();

  beforeAll(async () => {
    server = await MongoMemoryServer.create({
      instance: { dbName: 'gen01_notifications_disposable_test' },
    });
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(server.getUri(), {
          autoIndex: false,
          autoCreate: false,
        }),
        NotificationsModule,
      ],
    }).compile();
    await moduleRef.init();
    connection = moduleRef.get<Connection>(getConnectionToken());
    model = moduleRef.get<Model<Notification>>(getModelToken(Notification.name));
    service = moduleRef.get(NotificationsService);
  });

  beforeEach(async () => {
    await connection.dropDatabase();
  });

  afterAll(async () => {
    await moduleRef?.close();
    await server?.stop();
  });

  /** Inserts a notification directly, bypassing `notify()`, so `createdAt` can be fixed explicitly. */
  async function seed(overrides: {
    userId?: string;
    isRead?: boolean;
    createdAt: Date;
    title: string;
  }) {
    await model.create({
      userId: new Types.ObjectId(overrides.userId ?? userId),
      type: NotificationType.BOOKING_CONFIRMED,
      title: overrides.title,
      message: 'm',
      isRead: overrides.isRead ?? false,
      createdAt: overrides.createdAt,
      updatedAt: overrides.createdAt,
    });
  }

  it('returns the caller\'s notifications newest first, excluding other users', async () => {
    await seed({ title: 'oldest', createdAt: new Date('2026-01-01T00:00:00.000Z') });
    await seed({ title: 'newest', createdAt: new Date('2026-01-03T00:00:00.000Z') });
    await seed({ title: 'middle', createdAt: new Date('2026-01-02T00:00:00.000Z') });
    await seed({
      userId: otherUserId,
      title: "someone else's",
      createdAt: new Date('2026-01-04T00:00:00.000Z'),
    });

    const page = await service.list(user, { page: 1, limit: 10 });

    expect(page.total).toBe(3);
    expect(page.items.map((item) => item.title)).toEqual(['newest', 'middle', 'oldest']);
  });

  it('filters to only unread, or only read, notifications when asked', async () => {
    await seed({ title: 'read-1', isRead: true, createdAt: new Date('2026-01-01T00:00:00.000Z') });
    await seed({ title: 'unread-1', isRead: false, createdAt: new Date('2026-01-02T00:00:00.000Z') });
    await seed({ title: 'unread-2', isRead: false, createdAt: new Date('2026-01-03T00:00:00.000Z') });

    const unread = await service.list(user, { page: 1, limit: 10, isRead: false });
    expect(unread.total).toBe(2);
    expect(unread.items.map((item) => item.title)).toEqual(['unread-2', 'unread-1']);

    const read = await service.list(user, { page: 1, limit: 10, isRead: true });
    expect(read.total).toBe(1);
    expect(read.items.map((item) => item.title)).toEqual(['read-1']);

    const all = await service.list(user, { page: 1, limit: 10 });
    expect(all.total).toBe(3);
  });
});
