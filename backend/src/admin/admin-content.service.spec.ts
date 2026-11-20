import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Model, Types } from 'mongoose';
import { AuthenticatedUser, ContentType, Role } from '../common';
import { AuditService } from '../audit/audit.service';
import { BlogService } from '../blog/blog.service';
import { Comment } from '../blog/schemas/comment.schema';
import { Post } from '../blog/schemas/post.schema';
import { Hotel } from '../hotels/schemas/hotel.schema';
import { HotelReview } from '../hotels/schemas/hotel-review.schema';
import { Itinerary } from '../itineraries/schemas/itinerary.schema';
import { AdminContentService } from './admin-content.service';

function admin(): AuthenticatedUser {
  return { userId: new Types.ObjectId().toString(), role: Role.ADMIN };
}

function user(): AuthenticatedUser {
  return { userId: new Types.ObjectId().toString(), role: Role.USER };
}

describe('AdminContentService', () => {
  const ID = new Types.ObjectId().toString();
  let blog: { deletePostAndDependents: jest.Mock };
  let comments: { updateOne: jest.Mock; findOneAndDelete: jest.Mock };
  let hotels: { updateOne: jest.Mock };
  let hotelReviews: { findOneAndUpdate: jest.Mock; findOneAndDelete: jest.Mock; aggregate: jest.Mock };
  let itineraries: { updateOne: jest.Mock; deleteOne: jest.Mock };
  let posts: { updateOne: jest.Mock };
  let connection: { transaction: jest.Mock };
  let audit: { log: jest.Mock };
  let service: AdminContentService;

  beforeEach(() => {
    blog = { deletePostAndDependents: jest.fn().mockResolvedValue(undefined) };
    comments = { updateOne: jest.fn(), findOneAndDelete: jest.fn() };
    hotels = { updateOne: jest.fn().mockReturnValue({ exec: async () => ({ matchedCount: 1 }) }) };
    hotelReviews = {
      findOneAndUpdate: jest.fn(),
      findOneAndDelete: jest.fn(),
      aggregate: jest.fn().mockReturnValue({ session: () => ({ exec: async () => [] }) }),
    };
    itineraries = { updateOne: jest.fn(), deleteOne: jest.fn() };
    posts = { updateOne: jest.fn() };
    // Runs the callback against a no-op "session", matching real Mongoose transaction semantics closely enough
    // for this unit test (the real atomicity is proven at the e2e level, per this repo's convention).
    connection = { transaction: jest.fn((fn: (session: unknown) => Promise<void>) => fn({})) };
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    service = new AdminContentService(
      blog as unknown as BlogService,
      comments as unknown as Model<Comment>,
      hotels as unknown as Model<Hotel>,
      hotelReviews as unknown as Model<HotelReview>,
      itineraries as unknown as Model<Itinerary>,
      posts as unknown as Model<Post>,
      connection as never,
      audit as unknown as AuditService,
    );
  });

  describe('hide', () => {
    it('rejects a non-admin caller', async () => {
      await expect(service.hide(user(), ContentType.POST, ID)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('sets isHidden on a post and audits it', async () => {
      posts.updateOne.mockReturnValue({ exec: async () => ({ matchedCount: 1 }) });

      await service.hide(admin(), ContentType.POST, ID);

      expect(posts.updateOne).toHaveBeenCalledWith({ _id: ID }, { isHidden: true });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CONTENT_HIDDEN', targetType: ContentType.POST, targetId: ID }),
      );
    });

    it('answers 404 for an unknown post', async () => {
      posts.updateOne.mockReturnValue({ exec: async () => ({ matchedCount: 0 }) });
      await expect(service.hide(admin(), ContentType.POST, ID)).rejects.toBeInstanceOf(NotFoundException);
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('sets isHidden on a comment', async () => {
      comments.updateOne.mockReturnValue({ exec: async () => ({ matchedCount: 1 }) });
      await service.hide(admin(), ContentType.COMMENT, ID);
      expect(comments.updateOne).toHaveBeenCalledWith({ _id: ID }, { isHidden: true });
    });

    it('sets isHidden on an itinerary', async () => {
      itineraries.updateOne.mockReturnValue({ exec: async () => ({ matchedCount: 1 }) });
      await service.hide(admin(), ContentType.ITINERARY, ID);
      expect(itineraries.updateOne).toHaveBeenCalledWith({ _id: ID }, { isHidden: true });
    });

    it('hides a hotel review and recalculates the hotel rating', async () => {
      const hotelId = new Types.ObjectId();
      hotelReviews.findOneAndUpdate.mockReturnValue({ lean: async () => ({ _id: ID, hotelId }) });
      hotelReviews.aggregate.mockReturnValue({
        session: () => ({ exec: async () => [{ averageRating: 4.5, reviewCount: 2 }] }),
      });

      await service.hide(admin(), ContentType.REVIEW, ID);

      expect(hotelReviews.findOneAndUpdate).toHaveBeenCalledWith({ _id: ID }, { isHidden: true }, { session: {} });
      expect(hotels.updateOne).toHaveBeenCalledWith(
        { _id: hotelId },
        { $set: { averageRating: 4.5, reviewCount: 2 } },
        { session: {} },
      );
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CONTENT_HIDDEN', targetType: ContentType.REVIEW, targetId: ID }),
      );
    });

    it('answers 404 for an unknown hotel review', async () => {
      hotelReviews.findOneAndUpdate.mockReturnValue({ lean: async () => null });
      await expect(service.hide(admin(), ContentType.REVIEW, ID)).rejects.toBeInstanceOf(NotFoundException);
      expect(audit.log).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('rejects a non-admin caller', async () => {
      await expect(service.delete(user(), ContentType.POST, ID)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('reuses BlogService.deletePostAndDependents for a post', async () => {
      await service.delete(admin(), ContentType.POST, ID);
      expect(blog.deletePostAndDependents).toHaveBeenCalledWith({ _id: new Types.ObjectId(ID) });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CONTENT_DELETED', targetType: ContentType.POST }),
      );
    });

    it('deletes a comment and decrements the post comment count in one transaction', async () => {
      const postId = new Types.ObjectId();
      comments.findOneAndDelete.mockReturnValue({ lean: async () => ({ _id: ID, postId }) });
      posts.updateOne.mockReturnValue({ exec: async () => ({ modifiedCount: 1 }) });

      await service.delete(admin(), ContentType.COMMENT, ID);

      expect(connection.transaction).toHaveBeenCalledTimes(1);
      expect(posts.updateOne).toHaveBeenCalledWith(
        { _id: postId, commentCount: { $gt: 0 } },
        { $inc: { commentCount: -1 } },
        { session: {} },
      );
    });

    it('answers 404 for an unknown comment', async () => {
      comments.findOneAndDelete.mockReturnValue({ lean: async () => null });
      await expect(service.delete(admin(), ContentType.COMMENT, ID)).rejects.toBeInstanceOf(NotFoundException);
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('deletes an itinerary directly', async () => {
      itineraries.deleteOne.mockReturnValue({ exec: async () => ({ deletedCount: 1 }) });
      await service.delete(admin(), ContentType.ITINERARY, ID);
      expect(itineraries.deleteOne).toHaveBeenCalledWith({ _id: ID });
    });

    it('answers 404 for an unknown itinerary', async () => {
      itineraries.deleteOne.mockReturnValue({ exec: async () => ({ deletedCount: 0 }) });
      await expect(service.delete(admin(), ContentType.ITINERARY, ID)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('deletes a hotel review and recalculates the hotel rating', async () => {
      const hotelId = new Types.ObjectId();
      hotelReviews.findOneAndDelete.mockReturnValue({ lean: async () => ({ _id: ID, hotelId }) });
      hotelReviews.aggregate.mockReturnValue({ session: () => ({ exec: async () => [] }) });

      await service.delete(admin(), ContentType.REVIEW, ID);

      expect(hotelReviews.findOneAndDelete).toHaveBeenCalledWith({ _id: ID }, { session: {} });
      expect(hotels.updateOne).toHaveBeenCalledWith(
        { _id: hotelId },
        { $set: { averageRating: null, reviewCount: 0 } },
        { session: {} },
      );
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CONTENT_DELETED', targetType: ContentType.REVIEW }),
      );
    });

    it('answers 404 for an unknown hotel review', async () => {
      hotelReviews.findOneAndDelete.mockReturnValue({ lean: async () => null });
      await expect(service.delete(admin(), ContentType.REVIEW, ID)).rejects.toBeInstanceOf(NotFoundException);
      expect(audit.log).not.toHaveBeenCalled();
    });
  });
});
