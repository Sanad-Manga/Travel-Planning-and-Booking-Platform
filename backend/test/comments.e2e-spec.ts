import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { hashSync } from 'bcryptjs';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { AuthModule } from '../src/auth/auth.module';
import { BlogModule } from '../src/blog/blog.module';
import { COMMENT_MAX_LENGTH, Role } from '../src/common';
import configuration from '../src/config/configuration';
import { setupApp } from '../src/setup-app';
import { TEST_ACCESS_SECRET, TEST_REFRESH_SECRET } from './helpers/auth-test-app';

jest.setTimeout(120000);

describe('BLG-07 edit and delete own comments (e2e)', () => {
  let app: INestApplication;
  let mongo: MongoMemoryReplSet;
  let connection: Connection;

  const PASSWORD = 'Passw0rdOK';
  const http = () => request(app.getHttpServer());

  const insertUser = async (email: string, name: string, role: Role = Role.USER): Promise<string> => {
    const res = await connection.collection('users').insertOne({
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
    return res.insertedId.toString();
  };

  const loginCookie = async (email: string): Promise<string> => {
    const res = await http().post('/api/auth/login').send({ email, password: PASSWORD }).expect(200);
    return ((res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('access_token=')) as string).split(';')[0];
  };

  const publishedPost = async (cookie: string): Promise<string> => {
    const res = await http().post('/api/posts').set('Cookie', cookie).send({ title: 'A trip', body: 'Some text.', status: 'PUBLISHED' }).expect(201);
    return res.body.id;
  };
  const addComment = async (postId: string, cookie: string, body = 'First!'): Promise<string> =>
    (await http().post(`/api/posts/${postId}/comments`).set('Cookie', cookie).send({ body }).expect(201)).body.id;

  const edit = (id: string, cookie: string | undefined, body: unknown) => {
    const req = http().patch(`/api/comments/${id}`);
    return (cookie ? req.set('Cookie', cookie) : req).send(body as object);
  };
  const remove = (id: string, cookie?: string) => {
    const req = http().delete(`/api/comments/${id}`);
    return cookie ? req.set('Cookie', cookie) : req;
  };
  const oid = (id: string) => new Types.ObjectId(id);
  const storedComment = (id: string) => connection.collection('comments').findOne({ _id: oid(id) });
  const storedPost = (id: string) => connection.collection('posts').findOne({ _id: oid(id) });
  const setComment = (id: string, fields: Record<string, unknown>) => connection.collection('comments').updateOne({ _id: oid(id) }, { $set: fields });
  const setPost = (id: string, fields: Record<string, unknown>) => connection.collection('posts').updateOne({ _id: oid(id) }, { $set: fields });
  const detailsFields = (res: { body: { details?: { field: string }[] } }) => (res.body.details ?? []).map((d) => d.field);

  let writerCookie: string; // writes the comments
  let postAuthorCookie: string; // owns the post
  let otherCookie: string; // a third user
  let adminCookie: string;
  let moderatorCookie: string;
  let writerId: string;
  let postId: string;
  let commentId: string;

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = TEST_ACCESS_SECRET;
    process.env.JWT_REFRESH_SECRET = TEST_REFRESH_SECRET;
    process.env.COOKIE_SECURE = 'false';
    // A replica set: comment create and delete use MongoDB transactions.
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [configuration] }),
        MongooseModule.forRoot(mongo.getUri()),
        AuthModule,
        BlogModule,
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    connection = app.get<Connection>(getConnectionToken());
    await Promise.all([connection.model('Post').init(), connection.model('Comment').init()]);

    writerId = await insertUser('writer@example.com', 'Wanda Writer');
    await insertUser('postauthor@example.com', 'Paul Poster');
    await insertUser('other@example.com', 'Omar Ali');
    await insertUser('admin@example.com', 'Ada Admin', Role.ADMIN);
    await insertUser('hotelmod@example.com', 'Hana Hotel', Role.HOTEL_MODERATOR);
    [writerCookie, postAuthorCookie, otherCookie, adminCookie, moderatorCookie] = await Promise.all([
      loginCookie('writer@example.com'),
      loginCookie('postauthor@example.com'),
      loginCookie('other@example.com'),
      loginCookie('admin@example.com'),
      loginCookie('hotelmod@example.com'),
    ]);
  });

  afterAll(async () => {
    await app.close();
    await mongo.stop();
  });

  beforeEach(async () => {
    await connection.collection('comments').deleteMany({});
    await connection.collection('posts').deleteMany({});
    postId = await publishedPost(postAuthorCookie);
    commentId = await addComment(postId, writerCookie, 'Original text');
  });

  describe('PATCH /api/comments/:id', () => {
    it('the author edits their comment: trimmed text is stored, updatedAt moves, nothing else changes', async () => {
      const before = await storedComment(commentId);
      const res = await edit(commentId, writerCookie, { body: '  Edited text  ' }).expect(200);
      expect(res.body).toMatchObject({ id: commentId, postId, body: 'Edited text', author: { id: writerId, name: 'Wanda Writer' } });
      expect(res.body.createdAt).toBe(before?.createdAt.toISOString());
      expect(new Date(res.body.updatedAt).getTime()).toBeGreaterThanOrEqual(before?.updatedAt.getTime());
      const after = await storedComment(commentId);
      expect(after).toMatchObject({ body: 'Edited text', isHidden: false });
      expect(String(after?.authorId)).toBe(writerId);
      expect((await storedPost(postId))?.commentCount).toBe(1);
      const list = await http().get(`/api/posts/${postId}/comments`).set('Cookie', writerCookie).expect(200);
      expect(list.body.items.map((c: { body: string }) => c.body)).toEqual(['Edited text']);
    });

    it('accepts exactly 500 characters', async () => {
      const body = 'a'.repeat(COMMENT_MAX_LENGTH);
      const res = await edit(commentId, writerCookie, { body }).expect(200);
      expect(res.body.body).toBe(body);
    });

    it.each([
      ['an empty text', ''],
      ['whitespace only', '   \n\t '],
      ['501 characters', 'a'.repeat(COMMENT_MAX_LENGTH + 1)],
      ['a number', 42],
      ['null', null],
    ])('rejects %s with 400 and a body detail, and keeps the old text', async (_label, body) => {
      const res = await edit(commentId, writerCookie, { body }).expect(400);
      expect(res.body).toMatchObject({ statusCode: 400, message: 'Validation failed', path: `/api/comments/${commentId}` });
      expect([...new Set(detailsFields(res))]).toEqual(['body']); // one or more messages, all about body
      expect((await storedComment(commentId))?.body).toBe('Original text');
    });

    it('rejects a missing body, and unknown fields (authorId, isHidden, postId) with 400', async () => {
      const missing = await edit(commentId, writerCookie, {}).expect(400);
      expect(detailsFields(missing)).toContain('body');
      const extra = await edit(commentId, writerCookie, {
        body: 'Fine',
        authorId: new Types.ObjectId().toString(),
        isHidden: true,
        postId: new Types.ObjectId().toString(),
      }).expect(400);
      expect(detailsFields(extra)).toEqual(expect.arrayContaining(['authorId', 'isHidden', 'postId']));
      expect(await storedComment(commentId)).toMatchObject({ body: 'Original text', isHidden: false });
    });

    it("rejects someone else's comment with 403 (public content), even for the post author, and changes nothing", async () => {
      const res = await edit(commentId, otherCookie, { body: 'Hijacked' }).expect(403);
      expect(res.body).toMatchObject({ statusCode: 403, error: 'Forbidden' });
      await edit(commentId, postAuthorCookie, { body: 'Hijacked' }).expect(403);
      expect((await storedComment(commentId))?.body).toBe('Original text');
    });

    it("rejects an admin and a moderator editing someone else's comment with 403 (moderation is GEN-10)", async () => {
      await edit(commentId, adminCookie, { body: 'Admin edit' }).expect(403);
      await edit(commentId, moderatorCookie, { body: 'Moderator edit' }).expect(403);
      expect((await storedComment(commentId))?.body).toBe('Original text');
    });

    it('an admin or a moderator can edit their own comment', async () => {
      const adminComment = await addComment(postId, adminCookie, 'Admin says hi');
      await edit(adminComment, adminCookie, { body: 'Admin edited' }).expect(200);
      const modComment = await addComment(postId, moderatorCookie, 'Mod says hi');
      await edit(modComment, moderatorCookie, { body: 'Mod edited' }).expect(200);
    });

    it('answers 404 for an unknown id and for a malformed id', async () => {
      const unknown = await edit(new Types.ObjectId().toString(), writerCookie, { body: 'Hi' }).expect(404);
      expect(unknown.body).toMatchObject({ statusCode: 404, message: 'Comment not found' });
      await edit('not-an-id', writerCookie, { body: 'Hi' }).expect(404);
      await edit('123', writerCookie, { body: 'Hi' }).expect(404);
    });

    it('answers 401 to a guest', async () => {
      const res = await edit(commentId, undefined, { body: 'Guest edit' }).expect(401);
      expect(res.body.statusCode).toBe(401);
      expect((await storedComment(commentId))?.body).toBe('Original text');
    });

    it('a comment hidden by a moderator cannot be edited by its author (409) and stays hidden', async () => {
      await setComment(commentId, { isHidden: true });
      const res = await edit(commentId, writerCookie, { body: 'Sneaky edit' }).expect(409);
      expect(res.body).toMatchObject({ statusCode: 409, error: 'Conflict' });
      expect(await storedComment(commentId)).toMatchObject({ body: 'Original text', isHidden: true });
    });

    it('a hidden comment is invisible to other users (404); an admin who is not the author gets 403', async () => {
      await setComment(commentId, { isHidden: true });
      await edit(commentId, otherCookie, { body: 'x' }).expect(404);
      await edit(commentId, adminCookie, { body: 'x' }).expect(403);
    });

    it('a comment of a hidden post, a draft post or a deleted post answers 404 (same rule as creating a comment)', async () => {
      await setPost(postId, { isHidden: true });
      await edit(commentId, writerCookie, { body: 'Edit hidden post' }).expect(404);
      await setPost(postId, { isHidden: false, status: 'DRAFT' });
      await edit(commentId, writerCookie, { body: 'Edit draft post' }).expect(404);
      await setPost(postId, { status: 'PUBLISHED' });
      await http().delete(`/api/posts/${postId}`).set('Cookie', postAuthorCookie).expect(204);
      await edit(commentId, writerCookie, { body: 'Edit deleted post' }).expect(404);
      expect(await storedComment(commentId)).toBeNull();
    });
  });

  describe('DELETE /api/comments/:id', () => {
    it('the author deletes their comment (204, hard delete) and the post commentCount goes down', async () => {
      const second = await addComment(postId, otherCookie, 'Second');
      expect((await storedPost(postId))?.commentCount).toBe(2);
      await remove(commentId, writerCookie).expect(204).expect('');
      expect(await storedComment(commentId)).toBeNull();
      expect((await storedPost(postId))?.commentCount).toBe(1);
      const list = await http().get(`/api/posts/${postId}/comments`).set('Cookie', writerCookie).expect(200);
      expect(list.body.items.map((c: { id: string }) => c.id)).toEqual([second]);
      expect(list.body.total).toBe(1);
      await remove(commentId, writerCookie).expect(404); // already gone, the count does not go down twice
      expect((await storedPost(postId))?.commentCount).toBe(1);
    });

    it("rejects someone else's comment with 403, an admin and a moderator too, and deletes nothing", async () => {
      await remove(commentId, otherCookie).expect(403);
      await remove(commentId, postAuthorCookie).expect(403);
      await remove(commentId, adminCookie).expect(403);
      await remove(commentId, moderatorCookie).expect(403);
      expect(await storedComment(commentId)).not.toBeNull();
      expect((await storedPost(postId))?.commentCount).toBe(1);
    });

    it('answers 404 for an unknown or malformed id', async () => {
      await remove(new Types.ObjectId().toString(), writerCookie).expect(404);
      await remove('not-an-id', writerCookie).expect(404);
      expect((await storedPost(postId))?.commentCount).toBe(1);
    });

    it('answers 401 to a guest', async () => {
      await remove(commentId).expect(401);
      expect(await storedComment(commentId)).not.toBeNull();
    });

    it('the author may delete their own comment after a moderator hid it; the counter still goes down', async () => {
      await setComment(commentId, { isHidden: true });
      await remove(commentId, otherCookie).expect(404); // not theirs, and a hidden comment is not visible to them
      await remove(commentId, writerCookie).expect(204);
      expect(await storedComment(commentId)).toBeNull();
      expect((await storedPost(postId))?.commentCount).toBe(0);
    });

    it('a comment of a hidden post answers 404 and is kept (same rule as creating a comment)', async () => {
      await setPost(postId, { isHidden: true });
      await remove(commentId, writerCookie).expect(404);
      expect(await storedComment(commentId)).not.toBeNull();
      expect((await storedPost(postId))?.commentCount).toBe(1);
    });

    it('two concurrent deletes of the same comment: one 204, one 404, the counter drops once', async () => {
      const [a, b] = await Promise.all([remove(commentId, writerCookie), remove(commentId, writerCookie)]);
      expect([a.status, b.status].sort()).toEqual([204, 404]);
      expect((await storedPost(postId))?.commentCount).toBe(0);
    });
  });
});
