import {
  Controller,
  Get,
  INestApplication,
  Injectable,
  Module,
  NotFoundException,
  Param,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import {
  getConnectionToken,
  InjectModel,
  MongooseModule,
} from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { hashSync } from 'bcryptjs';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection, Model, Schema, Types } from 'mongoose';
import request from 'supertest';
import { AuthModule } from '../src/auth/auth.module';
import {
  assertCanViewBooking,
  assertOwner,
  bookingVisibilityFilter,
} from '../src/common/ownership';
import { AuthenticatedUser, CurrentUser, Role } from '../src/common';
import configuration from '../src/config/configuration';
import { setupApp } from '../src/setup-app';
import {
  TEST_ACCESS_SECRET,
  TEST_REFRESH_SECRET,
} from './helpers/auth-test-app';

/**
 * ACC-11: the ownership helper against a real database. Everything below is test-only: a tiny model, service and
 * controller defined in this file and never registered in AppModule. The "booking" and "private note" documents
 * use ObjectId fields, like the real schemas, so string/ObjectId comparisons are exercised for real.
 */
const probeSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, required: true },
  airlineId: { type: Schema.Types.ObjectId },
  hotelId: { type: Schema.Types.ObjectId },
  label: String,
});
const PROBE = 'OwnershipProbe';

@Injectable()
class ProbeService {
  constructor(
    @InjectModel(PROBE)
    private readonly model: Model<{
      userId: Types.ObjectId;
      airlineId?: Types.ObjectId;
      hotelId?: Types.ObjectId;
      label: string;
    }>,
  ) {}

  async getBooking(user: AuthenticatedUser, id: string) {
    const doc = await this.model.findById(id).lean();
    if (!doc) throw new NotFoundException('Booking not found');
    assertCanViewBooking(
      user,
      { ownerId: doc.userId, airlineId: doc.airlineId, hotelId: doc.hotelId },
      'Booking not found',
    );
    return { id: String(doc._id), label: doc.label };
  }

  async getPrivate(user: AuthenticatedUser, id: string) {
    const doc = await this.model.findById(id).lean();
    if (!doc) throw new NotFoundException('Note not found');
    assertOwner(user, { ownerId: doc.userId }, 'Note not found');
    return { id: String(doc._id), label: doc.label };
  }

  async listBookings(user: AuthenticatedUser) {
    const docs = await this.model.find(bookingVisibilityFilter(user)).lean();
    return docs.map((d) => d.label).sort();
  }
}

@Controller('ownership-probe')
class ProbeController {
  constructor(private readonly service: ProbeService) {}

  @Get('bookings')
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.service.listBookings(user);
  }

  @Get('bookings/:id')
  booking(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.getBooking(user, id);
  }

  @Get('private/:id')
  priv(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.getPrivate(user, id);
  }
}

@Module({
  imports: [MongooseModule.forFeature([{ name: PROBE, schema: probeSchema }])],
  controllers: [ProbeController],
  providers: [ProbeService],
})
class ProbeModule {}

describe('ownership helper on a real database (ACC-11, e2e)', () => {
  let app: INestApplication;
  let mongo: MongoMemoryServer;
  let connection: Connection;

  const PASSWORD = 'Passw0rdOK';
  const airlineA = new Types.ObjectId();
  const airlineB = new Types.ObjectId();
  const hotelA = new Types.ObjectId();
  const hotelB = new Types.ObjectId();
  const http = () => request(app.getHttpServer());

  const ids: Record<string, Types.ObjectId> = {};
  const cookies: Record<string, string> = {};
  const docs: Record<string, string> = {};

  async function createUser(
    key: string,
    role: Role,
    extra: Record<string, unknown> = {},
  ) {
    const email = `${key}@example.com`.toLowerCase(); // login lowercases the email
    const { insertedId } = await connection.collection('users').insertOne({
      name: key,
      email,
      passwordHash: hashSync(PASSWORD, 4),
      role,
      status: 'ACTIVE',
      consentAcceptedAt: new Date(),
      preferredCurrency: 'USD',
      createdAt: new Date(),
      updatedAt: new Date(),
      ...extra,
    });
    ids[key] = insertedId;
    const res = await http()
      .post('/api/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    cookies[key] = (res.headers['set-cookie'] as unknown as string[])
      .map((c) => c.split(';')[0])
      .join('; ');
  }

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
        ProbeModule,
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    connection = app.get<Connection>(getConnectionToken());
    await connection.model('User').init();

    await createUser('alice', Role.USER);
    await createUser('bob', Role.USER);
    await createUser('admin', Role.ADMIN);
    await createUser('airlineModA', Role.AIRLINE_MODERATOR, {
      airlineId: airlineA,
    });
    await createUser('airlineModB', Role.AIRLINE_MODERATOR, {
      airlineId: airlineB,
    });
    await createUser('hotelModA', Role.HOTEL_MODERATOR, { hotelId: hotelA });
    await createUser('hotelModB', Role.HOTEL_MODERATOR, { hotelId: hotelB });

    const probe = connection.collection('ownershipprobes');
    const insert = async (key: string, doc: Record<string, unknown>) => {
      const { insertedId } = await probe.insertOne(doc);
      docs[key] = insertedId.toHexString();
    };
    await insert('aliceFlight', {
      userId: ids.alice,
      airlineId: airlineA,
      label: 'alice-flight',
    });
    await insert('aliceHotel', {
      userId: ids.alice,
      hotelId: hotelA,
      label: 'alice-hotel',
    });
    await insert('bobFlight', {
      userId: ids.bob,
      airlineId: airlineB,
      label: 'bob-flight',
    });
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
  });

  const getAs = (who: string, path: string) =>
    http().get(`/api/ownership-probe/${path}`).set('Cookie', cookies[who]);

  describe('private resource (owner only)', () => {
    it('owner -> 200', async () => {
      const res = await getAs('alice', `private/${docs.aliceFlight}`).expect(
        200,
      );
      expect(res.body).toEqual({ id: docs.aliceFlight, label: 'alice-flight' });
    });

    it("another real user -> 404 with the caller's message, same as a missing id", async () => {
      const res = await getAs('bob', `private/${docs.aliceFlight}`).expect(404);
      const missing = await getAs(
        'bob',
        `private/${new Types.ObjectId().toHexString()}`,
      ).expect(404);
      expect(res.body).toMatchObject({
        statusCode: 404,
        error: 'Not Found',
        message: 'Note not found',
      });
      expect(res.body.message).toBe(missing.body.message);
    });

    it('admin and moderators are NOT allowed on the owner-only check', async () => {
      await getAs('admin', `private/${docs.aliceFlight}`).expect(404);
      await getAs('airlineModA', `private/${docs.aliceFlight}`).expect(404);
    });
  });

  describe('booking (owner, admin, matching moderator)', () => {
    it('owner -> 200', async () => {
      await getAs('alice', `bookings/${docs.aliceFlight}`).expect(200);
      await getAs('alice', `bookings/${docs.aliceHotel}`).expect(200);
    });

    it('another user -> 404', async () => {
      const res = await getAs('bob', `bookings/${docs.aliceFlight}`).expect(
        404,
      );
      expect(res.body.message).toBe('Booking not found');
    });

    it('admin -> 200 on any booking', async () => {
      await getAs('admin', `bookings/${docs.aliceFlight}`).expect(200);
      await getAs('admin', `bookings/${docs.aliceHotel}`).expect(200);
      await getAs('admin', `bookings/${docs.bobFlight}`).expect(200);
    });

    it('matching airline moderator -> 200; another airline moderator -> 404', async () => {
      await getAs('airlineModA', `bookings/${docs.aliceFlight}`).expect(200);
      await getAs('airlineModB', `bookings/${docs.aliceFlight}`).expect(404);
    });

    it('matching hotel moderator -> 200; another hotel moderator -> 404', async () => {
      await getAs('hotelModA', `bookings/${docs.aliceHotel}`).expect(200);
      await getAs('hotelModB', `bookings/${docs.aliceHotel}`).expect(404);
    });

    it('a moderator of the wrong type -> 404', async () => {
      await getAs('airlineModA', `bookings/${docs.aliceHotel}`).expect(404);
      await getAs('hotelModA', `bookings/${docs.aliceFlight}`).expect(404);
    });
  });

  describe('list filter', () => {
    const list = async (who: string) =>
      (await getAs(who, 'bookings').expect(200)).body as string[];

    it('user sees only their own', async () => {
      expect(await list('alice')).toEqual(['alice-flight', 'alice-hotel']);
      expect(await list('bob')).toEqual(['bob-flight']);
    });

    it('admin sees all', async () => {
      expect(await list('admin')).toEqual([
        'alice-flight',
        'alice-hotel',
        'bob-flight',
      ]);
    });

    it('moderators see only their own airline / hotel', async () => {
      expect(await list('airlineModA')).toEqual(['alice-flight']);
      expect(await list('airlineModB')).toEqual(['bob-flight']);
      expect(await list('hotelModA')).toEqual(['alice-hotel']);
      expect(await list('hotelModB')).toEqual([]);
    });
  });
});
