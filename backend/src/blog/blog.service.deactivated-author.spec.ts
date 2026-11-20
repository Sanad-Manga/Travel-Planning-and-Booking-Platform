import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { AuthenticatedUser, PostStatus, Role } from '../common';
import { BlogService } from './blog.service';

/** ACC-12: posts of a deactivated author. Collaborators are mocked; the end-to-end proof is test/blog-deactivated-author.e2e-spec.ts. */
describe('BlogService and deactivated authors (ACC-12)', () => {
  const goneId = new Types.ObjectId();
  const postId = new Types.ObjectId();
  const users = { findDeactivatedIds: jest.fn(), isDeactivated: jest.fn(), findById: jest.fn() };
  const comments = { list: jest.fn() };
  const postItinerary = { visibleItinerary: jest.fn() };
  const exec = jest.fn();
  const posts = {
    findById: jest.fn(() => ({ lean: () => ({ exec }) })),
    find: jest.fn(),
    countDocuments: jest.fn(),
    aggregate: jest.fn(),
  };
  const post = { _id: postId, authorId: goneId, status: PostStatus.PUBLISHED, isHidden: false, title: 'T', body: 'B', tags: [], images: [] };

  const make = () =>
    new BlogService(posts as never, {} as never, {} as never, users as never, comments as never, postItinerary as never, {} as never);
  const viewer = (role: Role): AuthenticatedUser => ({ userId: new Types.ObjectId().toString(), role });

  beforeEach(() => {
    jest.clearAllMocks();
    exec.mockResolvedValue(post);
    users.findDeactivatedIds.mockResolvedValue([goneId]);
    users.isDeactivated.mockResolvedValue(true);
    users.findById.mockResolvedValue({ name: 'Gina' });
    comments.list.mockResolvedValue({ items: [] });
    postItinerary.visibleItinerary.mockResolvedValue(null);
  });

  it('the public list excludes deactivated authors inside the database filter (so totals stay right)', async () => {
    const chain = { sort: () => chain, skip: () => chain, limit: () => chain, lean: () => chain, exec: () => Promise.resolve([]) };
    posts.find.mockReturnValue(chain);
    posts.countDocuments.mockReturnValue({ exec: () => Promise.resolve(0) });
    await make().listPublished({ page: 1, limit: 10 } as never);
    const filter = (posts.find.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(filter).toMatchObject({ status: PostStatus.PUBLISHED, isHidden: false, authorId: { $nin: [goneId] } });
  });

  it('search receives the same exclusion in its first $match', async () => {
    posts.aggregate.mockResolvedValue([{ items: [], total: [] }]);
    await make().listPublished({ page: 1, limit: 10, q: 'trip' } as never);
    const pipeline = (posts.aggregate.mock.calls[0] as unknown[][])[0] as { $match?: Record<string, unknown> }[];
    expect(pipeline[0].$match).toMatchObject({ authorId: { $nin: [goneId] } });
  });

  it.each([undefined, viewer(Role.USER), viewer(Role.HOTEL_MODERATOR)])('detail is a 404 for %p when the author is deactivated', async (who) => {
    await expect(make().findOne(postId.toString(), who)).rejects.toBeInstanceOf(NotFoundException);
    expect(comments.list).not.toHaveBeenCalled();
  });

  it('an admin still opens the post', async () => {
    const result = await make().findOne(postId.toString(), viewer(Role.ADMIN));
    expect(result.title).toBe('T');
  });

  it('the post opens again once the author is not deactivated', async () => {
    users.isDeactivated.mockResolvedValue(false);
    await expect(make().findOne(postId.toString())).resolves.toMatchObject({ title: 'T' });
  });
});
