import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Model, Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import {
  ACCESS_TOKEN_COOKIE,
  AccountStatus,
  JwtAuthGuard,
  PostStatus,
  Role,
} from '../common';
import { ACCOUNT_STATUS_CHECKER } from '../common/guards/account-status';
import { setupApp } from '../setup-app';
import { UsersService } from '../users/users.service';
import { BlogModule } from './blog.module';
import { Like } from './schemas/like.schema';
import { Post } from './schemas/post.schema';

jest.setTimeout(120000);

describe('BLG-06 post likes integration', () => {
  let server: MongoMemoryReplSet;
  let app: INestApplication;
  let posts: Model<Post>;
  let likes: Model<Like>;
  let jwt: JwtService;
  let postId: string;

  const userId = new Types.ObjectId().toString();
  const postAuthorId = new Types.ObjectId().toString();
  const accounts = new Map<string, AccountStatus>();

  function cookie(id = userId): string {
    const token = jwt.sign({ sub: id, role: Role.USER });
    return `${ACCESS_TOKEN_COOKIE}=${token}`;
  }

  function likeEndpoint(): string {
    return `/api/posts/${postId}/like`;
  }

  beforeAll(async () => {
    server = await MongoMemoryReplSet.create({
      replSet: {
        count: 1,
        storageEngine: 'wiredTiger',
      },
    });

    const moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(server.getUri()),
        JwtModule.register({
          secret: 'blg06-disposable-test-signing-key',
          signOptions: { expiresIn: '5m' },
        }),
        BlogModule,
      ],
      providers: [
        {
          provide: APP_GUARD,
          useClass: JwtAuthGuard,
        },
        {
          provide: ACCOUNT_STATUS_CHECKER,
          useValue: {
            isActive: async (id: string) =>
              accounts.get(id) === AccountStatus.ACTIVE,
          },
        },
      ],
    })
      .overrideProvider(UsersService)
      .useValue({
        findById: async () => null,
      })
      .compile();

    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();

    posts = app.get<Model<Post>>(getModelToken(Post.name));
    likes = app.get<Model<Like>>(getModelToken(Like.name));
    jwt = app.get(JwtService);

    await Promise.all([posts.init(), likes.init()]);
  });

  beforeEach(async () => {
    await Promise.all([likes.deleteMany({}), posts.deleteMany({})]);
    accounts.clear();
    accounts.set(userId, AccountStatus.ACTIVE);

    const post = await posts.create({
      authorId: new Types.ObjectId(postAuthorId),
      title: 'A published trip',
      body: 'Post content',
      status: PostStatus.PUBLISHED,
      isHidden: false,
    });
    postId = post._id.toString();
  });

  afterAll(async () => {
    await app?.close();
    await server?.stop();
  });

  it('creates one like and returns the updated count', async () => {
    const response = await request(app.getHttpServer())
      .post(likeEndpoint())
      .set('Cookie', cookie())
      .expect(200);

    expect(response.body).toEqual({
      postId,
      liked: true,
      likeCount: 1,
    });
    expect(
      await likes.countDocuments({ postId: new Types.ObjectId(postId) }),
    ).toBe(1);
    expect((await posts.findById(postId))?.likeCount).toBe(1);
  });

  it('does not duplicate a like on repeated requests', async () => {
    await request(app.getHttpServer())
      .post(likeEndpoint())
      .set('Cookie', cookie())
      .expect(200);

    const response = await request(app.getHttpServer())
      .post(likeEndpoint())
      .set('Cookie', cookie())
      .expect(200);

    expect(response.body).toMatchObject({ liked: true, likeCount: 1 });
    expect(
      await likes.countDocuments({ postId: new Types.ObjectId(postId) }),
    ).toBe(1);
    expect((await posts.findById(postId))?.likeCount).toBe(1);
  });

  it('keeps one like and one count across parallel requests', async () => {
    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        request(app.getHttpServer())
          .post(likeEndpoint())
          .set('Cookie', cookie())
          .expect(200),
      ),
    );

    expect(responses.every((response) => response.body.liked)).toBe(true);
    expect(
      await likes.countDocuments({ postId: new Types.ObjectId(postId) }),
    ).toBe(1);
    expect((await posts.findById(postId))?.likeCount).toBe(1);
  });

  it('removes a like and decrements the count once', async () => {
    await request(app.getHttpServer())
      .post(likeEndpoint())
      .set('Cookie', cookie())
      .expect(200);

    const response = await request(app.getHttpServer())
      .delete(likeEndpoint())
      .set('Cookie', cookie())
      .expect(200);

    expect(response.body).toEqual({
      postId,
      liked: false,
      likeCount: 0,
    });
    expect(
      await likes.countDocuments({ postId: new Types.ObjectId(postId) }),
    ).toBe(0);
    expect((await posts.findById(postId))?.likeCount).toBe(0);
  });

  it('keeps repeated unlikes idempotent', async () => {
    const response = await request(app.getHttpServer())
      .delete(likeEndpoint())
      .set('Cookie', cookie())
      .expect(200);

    expect(response.body).toMatchObject({ liked: false, likeCount: 0 });
    expect((await posts.findById(postId))?.likeCount).toBe(0);
  });

  it('requires login to like or unlike', async () => {
    await request(app.getHttpServer()).post(likeEndpoint()).expect(401);
    await request(app.getHttpServer()).delete(likeEndpoint()).expect(401);
    expect(await likes.countDocuments({})).toBe(0);
  });

  it.each([
    { status: PostStatus.DRAFT, isHidden: false },
    { status: PostStatus.PUBLISHED, isHidden: true },
  ])('does not allow liking an unavailable post', async (changes) => {
    await posts.updateOne({ _id: postId }, { $set: changes });

    await request(app.getHttpServer())
      .post(likeEndpoint())
      .set('Cookie', cookie())
      .expect(404);

    expect(await likes.countDocuments({})).toBe(0);
    expect((await posts.findById(postId))?.likeCount).toBe(0);
  });
});
