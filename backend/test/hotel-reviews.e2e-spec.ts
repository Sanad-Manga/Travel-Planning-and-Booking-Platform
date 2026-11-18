import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { AccountStatus, Role } from '../src/common';
import { AuthModule } from '../src/auth/auth.module';
import configuration from '../src/config/configuration';
import { HotelsModule } from '../src/hotels/hotels.module';
import { setupApp } from '../src/setup-app';
import {
  TEST_ACCESS_SECRET,
  TEST_REFRESH_SECRET,
} from './helpers/auth-test-app';

describe('HTL-24 public hotel reviews (e2e, real MongoDB)', () => {
  let app: INestApplication;
  let mongo: MongoMemoryServer;
  let db: Connection;

  const hotelId = new Types.ObjectId();
  const inactiveHotelId = new Types.ObjectId();
  const emptyHotelId = new Types.ObjectId();
  const activeAuthorId = new Types.ObjectId();
  const deletedAuthorId = new Types.ObjectId();
  const baseTime = new Date('2026-10-01T00:00:00.000Z');
  const ratings = [5, 4, 3, 2, 1, 5, 4, 3, 2, 1, 5];
  const http = () => request(app.getHttpServer());
  const reviews = (id: Types.ObjectId | string, query = '') =>
    http().get(`/api/hotels/${String(id)}/reviews${query}`);

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
        HotelsModule,
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    db = app.get<Connection>(getConnectionToken());
    await db.model('HotelReview').init();

    const now = new Date();
    await db.collection('hotels').insertMany([
      {
        _id: hotelId,
        name: 'Review Hotel',
        nameKey: 'review hotel',
        address: '1 Test Street',
        cityId: 'CAI',
        countryCode: 'EG',
        description: 'A hotel used for review tests.',
        photos: [],
        starRating: 4,
        amenities: [],
        cancellationTiers: [],
        averageRating: null,
        reviewCount: 0,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        _id: inactiveHotelId,
        name: 'Inactive Hotel',
        nameKey: 'inactive hotel',
        address: '2 Test Street',
        cityId: 'CAI',
        countryCode: 'EG',
        description: 'Inactive hotel.',
        photos: [],
        starRating: 3,
        amenities: [],
        cancellationTiers: [],
        isActive: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        _id: emptyHotelId,
        name: 'Empty Reviews Hotel',
        nameKey: 'empty reviews hotel',
        address: '3 Test Street',
        cityId: 'CAI',
        countryCode: 'EG',
        description: 'Hotel without reviews.',
        photos: [],
        starRating: 3,
        amenities: [],
        cancellationTiers: [],
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    await db.collection('users').insertMany([
      {
        _id: activeAuthorId,
        name: 'Active Author',
        email: `${activeAuthorId.toHexString()}@reviews.test`,
        passwordHash: 'not-used-in-this-test',
        role: Role.USER,
        status: AccountStatus.ACTIVE,
        consentAcceptedAt: now,
        createdAt: now,
        updatedAt: now,
      },
      {
        _id: deletedAuthorId,
        name: 'Deactivated Author',
        email: `${deletedAuthorId.toHexString()}@reviews.test`,
        passwordHash: 'not-used-in-this-test',
        role: Role.USER,
        status: AccountStatus.DEACTIVATED,
        consentAcceptedAt: now,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const visibleReviews = ratings.map((rating, index) => {
      const createdAt = new Date(baseTime.getTime() + index * 1000);
      return {
        bookingId: new Types.ObjectId(),
        hotelId,
        authorId:
          index === ratings.length - 1 ? deletedAuthorId : activeAuthorId,
        rating,
        comment: `Review ${index + 1}`,
        isHidden: false,
        createdAt,
        updatedAt: createdAt,
      };
    });
    const hiddenCreatedAt = new Date(
      baseTime.getTime() + ratings.length * 1000,
    );
    await db.collection('hotelReviews').insertMany([
      ...visibleReviews,
      {
        bookingId: new Types.ObjectId(),
        hotelId,
        authorId: activeAuthorId,
        rating: 1,
        comment: 'Hidden review',
        isHidden: true,
        createdAt: hiddenCreatedAt,
        updatedAt: hiddenCreatedAt,
      },
    ]);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
  });

  it('is guest-accessible and returns the visible rating summary with newest-first pages of 10', async () => {
    const first = await reviews(hotelId).expect(200);
    expect(first.body).toMatchObject({
      averageRating:
        ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length,
      reviewCount: ratings.length,
    });
    expect(first.body.reviews).toMatchObject({
      page: 1,
      limit: 10,
      total: ratings.length,
      totalPages: 2,
    });
    expect(first.body.reviews.items).toHaveLength(10);
    expect(first.body.reviews.items[0]).toMatchObject({
      comment: 'Review 11',
      authorName: 'Deleted user',
    });
    expect(
      first.body.reviews.items.find(
        (item: { comment: string }) => item.comment === 'Review 10',
      ),
    ).toMatchObject({ authorName: 'Active Author' });
    expect(
      first.body.reviews.items.map((item: { comment: string }) => item.comment),
    ).toEqual([
      'Review 11',
      'Review 10',
      'Review 9',
      'Review 8',
      'Review 7',
      'Review 6',
      'Review 5',
      'Review 4',
      'Review 3',
      'Review 2',
    ]);
    expect(
      first.body.reviews.items.some(
        (item: { comment: string }) => item.comment === 'Hidden review',
      ),
    ).toBe(false);

    const second = await reviews(hotelId, '?page=2').expect(200);
    expect(second.body).toMatchObject({
      averageRating: first.body.averageRating,
      reviewCount: ratings.length,
    });
    expect(second.body.reviews).toMatchObject({
      page: 2,
      limit: 10,
      total: ratings.length,
      totalPages: 2,
    });
    expect(
      second.body.reviews.items.map(
        (item: { comment: string }) => item.comment,
      ),
    ).toEqual(['Review 1']);
  });

  it('returns a null average and empty page when there are no visible reviews', async () => {
    const response = await reviews(emptyHotelId).expect(200);
    expect(response.body).toEqual({
      averageRating: null,
      reviewCount: 0,
      reviews: {
        items: [],
        page: 1,
        limit: 10,
        total: 0,
        totalPages: 0,
      },
    });
  });

  it('returns a 404 for malformed, missing, or inactive hotels', async () => {
    for (const id of ['not-an-id', new Types.ObjectId(), inactiveHotelId]) {
      const response = await reviews(id).expect(404);
      expect(response.body).toMatchObject({
        statusCode: 404,
        message: 'Hotel not found',
      });
    }
  });

  it('validates pagination and rejects unknown query parameters', async () => {
    await reviews(hotelId, '?page=0').expect(400);
    await reviews(hotelId, '?limit=51').expect(400);
    await reviews(hotelId, '?unexpected=true').expect(400);
  });

  it('documents the guest endpoint and its response in Swagger', async () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('test').build(),
    );
    const operation = document.paths['/api/hotels/{id}/reviews']?.get;
    expect(operation).toBeDefined();
    expect(operation?.summary).toContain('HTL-24');
    expect(operation?.security).toEqual([]);
    expect(Object.keys(operation?.responses ?? {})).toEqual(
      expect.arrayContaining(['200', '400', '404']),
    );
    expect(document.components?.schemas?.HotelReviewsResponseDto).toBeDefined();
    expect(document.components?.schemas?.HotelReviewsPageDto).toBeDefined();
  });
});
