import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { hashSync } from 'bcryptjs';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection, Types } from 'mongoose';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { AuthModule } from '../src/auth/auth.module';
import { Role } from '../src/common';
import configuration from '../src/config/configuration';
import {
  EXCHANGE_RATE_PROVIDER,
  FetchedRates,
} from '../src/fx/exchange-rate-provider';
import { ItinerariesModule } from '../src/itineraries';
import { setupApp, setupSwagger } from '../src/setup-app';
import { UPLOAD_OPTIONS } from '../src/uploads/upload-options';
import { pdfPageCount, pdfText } from './helpers/pdf-text';
import {
  TEST_ACCESS_SECRET,
  TEST_REFRESH_SECRET,
} from './helpers/auth-test-app';

const PASSWORD = 'Passw0rdOK';

describe('export an itinerary as PDF (ITN-28) over HTTP', () => {
  let app: INestApplication;
  let mongo: MongoMemoryServer;
  let db: Connection;
  let uploadRoot: string;
  let alice: string;
  let bob: string;
  let admin: string;

  const http = () => request(app.getHttpServer());
  /** supertest does not keep binary bodies by default. */
  const binary = (req: request.Test) =>
    req.buffer(true).parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => done(null, Buffer.concat(chunks)));
    });
  const ownerPdf = (cookie: string | null, id: string) => {
    const req = http().get(`/api/itineraries/${id}/pdf`);
    return binary(cookie ? req.set('Cookie', cookie) : req);
  };
  const publicPdf = (id: string) =>
    binary(http().get(`/api/itineraries/public/${id}/pdf`));

  async function loginAs(
    email: string,
    role: Role = Role.USER,
    name = email,
  ): Promise<string> {
    await db.collection('users').insertOne({
      name,
      email,
      passwordHash: hashSync(PASSWORD, 4),
      role,
      status: 'ACTIVE',
      consentAcceptedAt: new Date(),
      preferredCurrency: 'USD',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const response = await http()
      .post('/api/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return (response.headers['set-cookie'] as unknown as string[])
      .map((c) => c.split(';')[0])
      .join('; ');
  }

  /** Alice's itinerary: Cairo day with an activity and two budget entries, a Dubai day, and a flight cost. */
  async function plannedTrip(
    title = 'Two weeks in Egypt and the UAE',
  ): Promise<string> {
    const created = await http()
      .post('/api/itineraries')
      .set('Cookie', alice)
      .send({ title, countryCodes: ['EG', 'AE'], startDate: '2026-12-20' })
      .expect(201);
    const id = created.body.id as string;
    const first = await http()
      .post(`/api/itineraries/${id}/days`)
      .set('Cookie', alice)
      .send({ cityId: 'cairo', notes: 'Arrive and rest' })
      .expect(201);
    const second = await http()
      .post(`/api/itineraries/${id}/days`)
      .set('Cookie', alice)
      .send({ cityId: 'dubai' })
      .expect(201);
    await http()
      .post(`/api/itineraries/${id}/days/${first.body.id}/activities`)
      .set('Cookie', alice)
      .send({
        name: 'Pyramids visit',
        description: 'Morning tour',
        time: '09:30',
        costCents: 6000,
      })
      .expect(201);
    await http()
      .post(`/api/itineraries/${id}/days/${first.body.id}/budgets`)
      .set('Cookie', alice)
      .send({ category: 'FOOD', amountCents: 2500, currency: 'EGP' })
      .expect(201);
    await http()
      .post(`/api/itineraries/${id}/days/${first.body.id}/budgets`)
      .set('Cookie', alice)
      .send({ category: 'ACCOMMODATION', amountCents: 9000 })
      .expect(201);
    await http()
      .post(`/api/itineraries/${id}/transport-costs`)
      .set('Cookie', alice)
      .send({
        mode: 'FLIGHT',
        fromCityId: 'cairo',
        toCityId: 'dubai',
        amountCents: 30000,
        currency: 'USD',
        dayId: second.body.id,
      })
      .expect(201);
    return id;
  }
  const setVisibility = (id: string, visibility: 'PUBLIC' | 'PRIVATE') =>
    http()
      .patch(`/api/itineraries/${id}`)
      .set('Cookie', alice)
      .send({ visibility })
      .expect(200);

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = TEST_ACCESS_SECRET;
    process.env.JWT_REFRESH_SECRET = TEST_REFRESH_SECRET;
    process.env.COOKIE_SECURE = 'false';
    mongo = await MongoMemoryServer.create();
    uploadRoot = await fs.mkdtemp(join(tmpdir(), 'itn28-e2e-'));
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [configuration],
        }),
        MongooseModule.forRoot(mongo.getUri()),
        AuthModule,
        ItinerariesModule,
      ],
    })
      .overrideProvider(EXCHANGE_RATE_PROVIDER)
      .useValue({
        fetchLatest: (base: string): Promise<FetchedRates> =>
          Promise.resolve({
            base,
            rateDate: new Date().toISOString().slice(0, 10),
            rates: { EGP: 48, AED: 3.67 },
          }),
      })
      .overrideProvider(UPLOAD_OPTIONS)
      .useValue({
        root: uploadRoot,
        leaseMs: 60_000,
        recoveryIntervalMs: 3_600_000,
        recoveryBatchSize: 50,
      })
      .compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    setupSwagger(app);
    await app.init();
    db = app.get<Connection>(getConnectionToken());
    await db.model('User').init();

    await db.collection('countries').insertMany([
      { code: 'EG', name: 'Egypt', currency: 'EGP' },
      { code: 'AE', name: 'United Arab Emirates', currency: 'AED' },
    ]);
    await db.collection('cities').insertMany([
      { city_id: 'cairo', name: 'Cairo', country_code: 'EG' },
      { city_id: 'dubai', name: 'Dubai', country_code: 'AE' },
    ]);
    await db
      .collection('currencies')
      .insertMany([{ code: 'USD' }, { code: 'EGP' }]);

    alice = await loginAs('pdf-alice@example.com', Role.USER, 'Alice Author');
    bob = await loginAs('pdf-bob@example.com');
    admin = await loginAs('pdf-admin@example.com', Role.ADMIN);
  }, 180_000);

  beforeEach(async () => {
    await db.collection('itineraries').deleteMany({});
    await db.collection('budgets').deleteMany({});
    await db.collection('activities').deleteMany({});
    await db.collection('transportcosts').deleteMany({});
  });

  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
    await fs.rm(uploadRoot, { recursive: true, force: true });
  });

  describe('the owner', () => {
    it('downloads a real PDF attachment with the days, cities, activities and budget', async () => {
      const id = await plannedTrip();

      const response = await ownerPdf(alice, id).expect(200);

      expect(response.headers['content-type']).toContain('application/pdf');
      expect(response.headers['content-disposition']).toMatch(
        /^attachment; filename="itinerary-two-weeks-in-egypt-and-the-uae\.pdf"$/,
      );
      expect(Number(response.headers['content-length'])).toBe(
        response.body.length,
      );
      const pdf = response.body as Buffer;
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
      expect(pdf.toString('latin1').trimEnd().endsWith('%%EOF')).toBe(true);

      const text = pdfText(pdf);
      expect(text).toContain('Two weeks in Egypt and the UAE');
      expect(text).toContain('Countries: EG, AE');
      expect(text).toContain('Day 1 - Cairo - 2026-12-20');
      expect(text).toContain('Day 2 - Dubai - 2026-12-21');
      expect(text).toContain('Arrive and rest');
      expect(text).toContain('09:30  Pyramids visit - 60.00 USD');
      expect(text).toContain('Budget');
      expect(text).toContain('USD: 450.00 USD'); // accommodation 90 + flight 300 + activity 60
      expect(text).toContain('Accommodation: 90.00 USD');
      expect(text).toContain('Intercity transport: 300.00 USD');
      expect(text).toContain('Activities: 60.00 USD');
      expect(text).toContain('EGP: 25.00 EGP');
      expect(text).toContain('By Alice Author');
    });

    it('exports an itinerary with no days and no costs yet', async () => {
      const created = await http()
        .post('/api/itineraries')
        .set('Cookie', alice)
        .send({
          title: 'Empty plan',
          countryCodes: ['EG'],
          startDate: '2026-12-20',
        })
        .expect(201);

      const response = await ownerPdf(alice, created.body.id).expect(200);

      const text = pdfText(response.body as Buffer);
      expect(text).toContain('No days have been planned yet.');
      expect(text).toContain('No costs have been planned yet.');
    });

    it('survives a title that the standard PDF font cannot draw', async () => {
      const id = await plannedTrip('رحلة مصر ✈');
      const response = await ownerPdf(alice, id).expect(200);
      expect(response.headers['content-disposition']).toContain(
        'filename="itinerary.pdf"',
      );
      expect((response.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    });

    it('can export its own itinerary even when an admin has hidden it', async () => {
      const id = await plannedTrip();
      await db
        .collection('itineraries')
        .updateOne(
          { _id: new Types.ObjectId(id) },
          { $set: { isHidden: true } },
        );
      await ownerPdf(alice, id).expect(200);
    });

    it('fills several pages for a long itinerary', async () => {
      const created = await http()
        .post('/api/itineraries')
        .set('Cookie', alice)
        .send({ title: 'Long', countryCodes: ['EG'], startDate: '2026-12-20' })
        .expect(201);
      for (let i = 0; i < 40; i += 1) {
        const added = await http()
          .post(`/api/itineraries/${created.body.id}/days`)
          .set('Cookie', alice)
          .send({ cityId: 'cairo', notes: `Notes of day ${i + 1}` })
          .expect(201);
        await http()
          .post(
            `/api/itineraries/${created.body.id}/days/${added.body.id}/activities`,
          )
          .set('Cookie', alice)
          .send({ name: `Activity ${i + 1}`, time: '10:00', costCents: 1000 })
          .expect(201);
      }
      const response = await ownerPdf(alice, created.body.id).expect(200);
      expect(pdfPageCount(response.body as Buffer)).toBeGreaterThan(1);
      expect(pdfText(response.body as Buffer)).toContain('Activity 40');
    });
  });

  describe('who can export', () => {
    it('refuses a guest (401) and an admin (403) on the owner route', async () => {
      const id = await plannedTrip();
      await ownerPdf(null, id).expect(401);
      await ownerPdf(admin, id).expect(403);
    });

    it("answers 404 for someone else's private itinerary, an unknown one, and 400 for a malformed id", async () => {
      const id = await plannedTrip();
      await ownerPdf(bob, id).expect(404);
      await ownerPdf(alice, new Types.ObjectId().toHexString()).expect(404);
      await ownerPdf(alice, 'not-an-id').expect(400);
    });

    it('lets another traveler and a guest export a PUBLIC itinerary, and stops when it is private again', async () => {
      const id = await plannedTrip();
      await setVisibility(id, 'PUBLIC');

      const asBob = await ownerPdf(bob, id).expect(200);
      expect(pdfText(asBob.body as Buffer)).toContain(
        'Day 1 - Cairo - 2026-12-20',
      );
      const asGuest = await publicPdf(id).expect(200);
      expect(asGuest.headers['content-type']).toContain('application/pdf');
      expect(pdfText(asGuest.body as Buffer)).toContain('By Alice Author');
      expect(pdfText(asGuest.body as Buffer)).toContain('USD: 450.00 USD');

      await setVisibility(id, 'PRIVATE');
      await ownerPdf(bob, id).expect(404);
      await publicPdf(id).expect(404);
      await ownerPdf(alice, id).expect(200); // the owner still can
    });

    it('does not export a public itinerary that an admin hid or whose author is not active', async () => {
      const id = await plannedTrip();
      await setVisibility(id, 'PUBLIC');
      await db
        .collection('itineraries')
        .updateOne(
          { _id: new Types.ObjectId(id) },
          { $set: { isHidden: true } },
        );
      await publicPdf(id).expect(404);
      await ownerPdf(bob, id).expect(404);

      await db
        .collection('itineraries')
        .updateOne(
          { _id: new Types.ObjectId(id) },
          { $set: { isHidden: false } },
        );
      await db
        .collection('users')
        .updateOne(
          { email: 'pdf-alice@example.com' },
          { $set: { status: 'SUSPENDED' } },
        );
      await publicPdf(id).expect(404);
      await db
        .collection('users')
        .updateOne(
          { email: 'pdf-alice@example.com' },
          { $set: { status: 'ACTIVE' } },
        );
    });

    it('answers 404 and 400 on the public route for an unknown and a malformed id', async () => {
      await publicPdf(new Types.ObjectId().toHexString()).expect(404);
      await publicPdf('not-an-id').expect(400);
    });
  });

  it('documents both routes in Swagger as application/pdf', async () => {
    const response = await http().get('/api/docs-json').expect(200);
    const owner = response.body.paths['/api/itineraries/{id}/pdf'].get;
    const guest = response.body.paths['/api/itineraries/public/{id}/pdf'].get;
    for (const route of [owner, guest]) {
      expect(route.summary).toContain('ITN-28');
      expect(route.responses['200'].content['application/pdf']).toBeDefined();
      expect(Object.keys(route.responses)).toEqual(
        expect.arrayContaining(['400', '404']),
      );
    }
    expect(Object.keys(owner.responses)).toEqual(
      expect.arrayContaining(['401', '403']),
    );
  });
});
