import {
  afterAll,
  afterEach,
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
import {
  getModelToken,
  MongooseModule,
} from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Model, Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import {
  ACCESS_TOKEN_COOKIE,
  AccountStatus,
  AuthenticatedUser,
  JwtAuthGuard,
  PostStatus,
  Role,
} from '../common';
import { ACCOUNT_STATUS_CHECKER } from '../common/guards/account-status';
import { setupApp } from '../setup-app';
import { UsersService } from '../users/users.service';
import { BlogModule } from './blog.module';
import { CommentsService } from './comments.service';
import { CommentResponseDto } from './dto/comment-response.dto';
import { Comment } from './schemas/comment.schema';
import { Post } from './schemas/post.schema';

jest.setTimeout(120000);

describe('BLG-05 comments integration', () => {
  let server: MongoMemoryReplSet;
  let app: INestApplication;
  let posts: Model<Post>;
  let comments: Model<Comment>;
  let service: CommentsService;
  let jwt: JwtService;
  let postId: string;

  const authorId = new Types.ObjectId().toString();
  const otherId = new Types.ObjectId().toString();
  const adminId = new Types.ObjectId().toString();

  const actor: AuthenticatedUser = {
    userId: authorId,
    role: Role.USER,
  };

  const accounts = new Map<
    string,
    { name: string; status: AccountStatus }
  >();

  function cookie(userId = authorId, role = Role.USER): string {
    const token = jwt.sign({ sub: userId, role });
    return `${ACCESS_TOKEN_COOKIE}=${token}`;
  }

  function endpoint(): string {
    return `/api/posts/${postId}/comments`;
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
          secret: 'blg05-disposable-test-signing-key',
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
              accounts.get(id)?.status === AccountStatus.ACTIVE,
          },
        },
      ],
    })
      .overrideProvider(UsersService)
      .useValue({
        findById: async (id: string) => accounts.get(id) ?? null,
      })
      .compile();

    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();

    posts = app.get<Model<Post>>(getModelToken(Post.name));
    comments = app.get<Model<Comment>>(getModelToken(Comment.name));
    service = app.get(CommentsService);
    jwt = app.get(JwtService);

    await Promise.all([posts.init(), comments.init()]);
  });

  beforeEach(async () => {
    await comments.deleteMany({});
    await posts.deleteMany({});

    accounts.clear();
    accounts.set(authorId, {
      name: 'Comment author',
      status: AccountStatus.ACTIVE,
    });
    accounts.set(otherId, {
      name: 'Post author',
      status: AccountStatus.ACTIVE,
    });
    accounts.set(adminId, {
      name: 'Administrator',
      status: AccountStatus.ACTIVE,
    });

    const post = await posts.create({
      authorId: new Types.ObjectId(otherId),
      title: 'A published trip',
      body: 'Post content',
      status: PostStatus.PUBLISHED,
      isHidden: false,
    });

    postId = post._id.toString();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await app?.close();
    await server?.stop();
  });

  it('creates a comment on another user’s published post', async () => {
    const response = await request(app.getHttpServer())
      .post(endpoint())
      .set('Cookie', cookie())
      .send({ body: '  Helpful post!  ' })
      .expect(201);

    expect(response.body).toMatchObject({
      postId,
      body: 'Helpful post!',
      author: {
        id: authorId,
        name: 'Comment author',
      },
    });
    expect(response.body.id).toMatch(/^[0-9a-f]{24}$/);
    expect(response.body.createdAt).toMatch(/Z$/);
    expect(await comments.countDocuments({})).toBe(1);
    expect((await posts.findById(postId))?.commentCount).toBe(1);
  });

  it('rejects a guest with 401', async () => {
    await request(app.getHttpServer())
      .post(endpoint())
      .send({ body: 'Guest comment' })
      .expect(401);

    expect(await comments.countDocuments({})).toBe(0);
  });

  it.each(['', '   ', 'a'.repeat(501)])(
    'rejects invalid comment text through the endpoint',
    async (body) => {
      const response = await request(app.getHttpServer())
        .post(endpoint())
        .set('Cookie', cookie())
        .send({ body })
        .expect(400);

      expect(response.body).toMatchObject({
        statusCode: 400,
        error: 'Bad Request',
        path: endpoint(),
      });
      expect(await comments.countDocuments({})).toBe(0);
      expect((await posts.findById(postId))?.commentCount).toBe(0);
    },
  );

  it('rejects a client-supplied authorId', async () => {
    await request(app.getHttpServer())
      .post(endpoint())
      .set('Cookie', cookie())
      .send({ body: 'Comment', authorId: otherId })
      .expect(400);
  });

  it.each([
    { status: PostStatus.DRAFT, isHidden: false },
    { status: PostStatus.PUBLISHED, isHidden: true },
  ])('rejects commenting on an unavailable post', async (changes) => {
    await posts.updateOne({ _id: postId }, { $set: changes });

    await request(app.getHttpServer())
      .post(endpoint())
      .set('Cookie', cookie())
      .send({ body: 'Comment' })
      .expect(404);

    expect(await comments.countDocuments({})).toBe(0);
    expect((await posts.findById(postId))?.commentCount).toBe(0);
  });

  it('returns paginated comments oldest first', async () => {
    const dates = [
      '2026-11-03T12:00:00.000Z',
      '2026-11-01T12:00:00.000Z',
      '2026-11-02T12:00:00.000Z',
    ];

    await comments.insertMany(
      dates.map((date) => ({
        postId: new Types.ObjectId(postId),
        authorId: new Types.ObjectId(authorId),
        body: date,
        isHidden: false,
        createdAt: new Date(date),
        updatedAt: new Date(date),
      })),
    );

    const response = await request(app.getHttpServer())
      .get(`${endpoint()}?page=1&limit=2`)
      .set('Cookie', cookie())
      .expect(200);

    expect(response.body).toMatchObject({
      page: 1,
      limit: 2,
      total: 3,
      totalPages: 2,
    });

    const items = response.body.items as CommentResponseDto[];
    expect(items.map((item) => item.body)).toEqual([
      dates[1],
      dates[2],
    ]);

    const secondPage = await request(app.getHttpServer())
      .get(`${endpoint()}?page=2&limit=2`)
      .set('Cookie', cookie())
      .expect(200);

    expect(secondPage.body.items[0].body).toBe(dates[0]);
  });

  it('includes visible comments in the public post response', async () => {
    await service.create(postId, { body: 'Public comment' }, actor);

    const response = await request(app.getHttpServer())
      .get(`/api/posts/${postId}`)
      .expect(200);

    expect(response.body.comments).toHaveLength(1);
    expect(response.body.comments[0].body).toBe('Public comment');
  });

  it('shows a hidden comment only to its author and admins', async () => {
    const comment = await service.create(
      postId,
      { body: 'Hidden comment' },
      actor,
    );

    await comments.updateOne(
      { _id: comment.id },
      { $set: { isHidden: true } },
    );

    const publicPost = await request(app.getHttpServer())
      .get(`/api/posts/${postId}`)
      .expect(200);

    expect(publicPost.body.comments).toEqual([]);

    const otherUser = await request(app.getHttpServer())
      .get(endpoint())
      .set('Cookie', cookie(otherId))
      .expect(200);

    expect(otherUser.body.total).toBe(0);

    const author = await request(app.getHttpServer())
      .get(endpoint())
      .set('Cookie', cookie())
      .expect(200);

    expect(author.body.total).toBe(1);

    const admin = await request(app.getHttpServer())
      .get(endpoint())
      .set('Cookie', cookie(adminId, Role.ADMIN))
      .expect(200);

    expect(admin.body.total).toBe(1);
  });

  it.each(['missing', 'deactivated'])(
    'displays Deleted user for a %s author',
    async (state) => {
      await service.create(postId, { body: 'Comment' }, actor);

      if (state === 'missing') {
        accounts.delete(authorId);
      } else {
        accounts.set(authorId, {
          name: 'Former name',
          status: AccountStatus.DEACTIVATED,
        });
      }

      const response = await request(app.getHttpServer())
        .get(endpoint())
        .set('Cookie', cookie(otherId))
        .expect(200);

      expect(response.body.items[0].author.name).toBe('Deleted user');
    },
  );

   it('keeps the count correct for concurrent comments', async () => {
    const created = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        service.create(postId, { body: `Comment ${index}` }, actor),
      ),
    );

    const stored = await comments.find({}).lean().exec();
    const post = await posts.findById(postId).lean().exec();

    expect({
      returnedPostIds: created.map((comment) => comment.postId),
      storedPostIds: stored.map((comment) => comment.postId.toString()),
      matchingCount: await comments.countDocuments({
        postId: new Types.ObjectId(postId),
      }),
      postCommentCount: post?.commentCount,
    }).toEqual({
      returnedPostIds: Array(4).fill(postId),
      storedPostIds: Array(4).fill(postId),
      matchingCount: 4,
      postCommentCount: 4,
    });
  });

  it('rolls back the counter when comment insertion fails', async () => {
    jest.spyOn(comments, 'create').mockImplementationOnce(() => {
      throw new Error('Simulated comment insertion failure');
    });

    await expect(
      service.create(postId, { body: 'Comment' }, actor),
    ).rejects.toThrow('Simulated comment insertion failure');

    expect(await comments.countDocuments({ postId })).toBe(0);
    expect((await posts.findById(postId))?.commentCount).toBe(0);
  });
  it('lets guests read the second page of comments', async () => {
    await service.create(postId, { body: 'First comment' }, actor);
    await service.create(postId, { body: 'Second comment' }, actor);

    const response = await request(app.getHttpServer())
      .get(`/api/posts/${postId}?page=2&limit=1`)
      .expect(200);

    expect(response.body.comments).toHaveLength(1);
    expect(response.body.comments[0].body).toBe('Second comment');
  });});