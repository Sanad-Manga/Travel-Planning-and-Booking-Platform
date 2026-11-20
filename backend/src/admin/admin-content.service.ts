import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { AuthenticatedUser, ContentType, Role } from '../common';
import { AuditService } from '../audit/audit.service';
import { BlogService } from '../blog/blog.service';
import { Comment } from '../blog/schemas/comment.schema';
import { Post } from '../blog/schemas/post.schema';
import { Hotel } from '../hotels/schemas/hotel.schema';
import { HotelReview } from '../hotels/schemas/hotel-review.schema';
import { ItinerariesService } from '../itineraries/itineraries.service';
import { Itinerary } from '../itineraries/schemas/itinerary.schema';

/**
 * GEN-10: hides or deletes a post, comment, hotel review or itinerary, directly or as the result
 * of resolving a report. Shared by `AdminContentController` (direct moderation) and
 * `ReportsAdminService` (report resolution), so the two paths can never drift.
 *
 * Reuses `Post`/`Comment`/`HotelReview`/`Hotel`/`Itinerary` schema classes directly (no
 * module-boundary violation: the same pattern as `RefundsModule` reusing the `Payment` schema
 * class, and `ReportsModule` already reusing `Post`/`Itinerary` directly for its own read-only
 * lookups) rather than editing `blog`/`hotels`/`itineraries` files, which aren't mine. Post
 * deletion specifically reuses `BlogService.deletePostAndDependents` (its own doc comment invites
 * this: "Reusable for an admin delete (GEN-10)"), so the comment/like/image cascade stays correct
 * without duplicating it here.
 *
 * KNOWN GAP (flagged in the PR for Hessain): a hotel review's hide/delete must keep
 * `Hotel.averageRating`/`reviewCount` in sync, exactly mirroring
 * `HotelReviewsService.recalculateHotelRating`'s own aggregation (`{hotelId, isHidden: {$ne:
 * true}}` -> avg/count). That method is private and `HotelReviewsService` isn't exported from
 * `HotelsModule`, so it can't be called from here without editing hotels/ files — the aggregation
 * is duplicated below instead. If Hessain ever exposes a public variant, this should call that
 * instead of duplicating the logic.
 */
@Injectable()
export class AdminContentService {
  constructor(
    private readonly blog: BlogService,
    @InjectModel(Comment.name) private readonly comments: Model<Comment>,
    @InjectModel(Hotel.name) private readonly hotels: Model<Hotel>,
    @InjectModel(HotelReview.name) private readonly hotelReviews: Model<HotelReview>,
    @InjectModel(Itinerary.name) private readonly itineraries: Model<Itinerary>,
    @InjectModel(Post.name) private readonly posts: Model<Post>,
    @InjectConnection() private readonly connection: Connection,
    private readonly audit: AuditService,
    private readonly itinerariesService: ItinerariesService,
  ) {}

  /** Every call here is independently audit-logged (CONTENT_HIDDEN), whether reached directly or
   * via report resolution — `ReportsAdminService` adds its own extra entry on top for the latter. */
  async hide(actor: AuthenticatedUser, type: ContentType, id: string): Promise<void> {
    this.assertAdmin(actor);
    switch (type) {
      case ContentType.POST: {
        const result = await this.posts.updateOne({ _id: id }, { isHidden: true }).exec();
        if (result.matchedCount === 0) throw new NotFoundException('Post not found');
        break;
      }
      case ContentType.COMMENT: {
        const result = await this.comments.updateOne({ _id: id }, { isHidden: true }).exec();
        if (result.matchedCount === 0) throw new NotFoundException('Comment not found');
        break;
      }
      case ContentType.ITINERARY: {
        const result = await this.itineraries.updateOne({ _id: id }, { isHidden: true }).exec();
        if (result.matchedCount === 0) throw new NotFoundException('Itinerary not found');
        break;
      }
      case ContentType.REVIEW:
        await this.hideReview(id);
        break;
    }
    await this.audit.log({ actorId: actor.userId, action: 'CONTENT_HIDDEN', targetType: type, targetId: id });
  }

  /** Every call here is independently audit-logged (CONTENT_DELETED) — see `hide`'s note above. */
  async delete(actor: AuthenticatedUser, type: ContentType, id: string): Promise<void> {
    this.assertAdmin(actor);
    switch (type) {
      case ContentType.POST:
        await this.blog.deletePostAndDependents({ _id: new Types.ObjectId(id) });
        break;
      case ContentType.COMMENT:
        await this.deleteComment(id);
        break;
      case ContentType.ITINERARY: {
        await this.itinerariesService.removeAsAdmin(id);
        break;
      }
      case ContentType.REVIEW:
        await this.deleteReview(id);
        break;
    }
    await this.audit.log({ actorId: actor.userId, action: 'CONTENT_DELETED', targetType: type, targetId: id });
  }

  /** Mirrors CommentsService.remove's transaction (delete + commentCount decrement), without the ownership filter. */
  private async deleteComment(id: string): Promise<void> {
    await this.connection.transaction(async (session) => {
      const comment = await this.comments.findOneAndDelete({ _id: id }, { session }).lean();
      if (!comment) throw new NotFoundException('Comment not found');
      await this.posts.updateOne(
        { _id: comment.postId, commentCount: { $gt: 0 } },
        { $inc: { commentCount: -1 } },
        { session },
      );
    });
  }

  private async hideReview(id: string): Promise<void> {
    await this.connection.transaction(async (session) => {
      const review = await this.hotelReviews
        .findOneAndUpdate({ _id: id }, { isHidden: true }, { session })
        .lean();
      if (!review) throw new NotFoundException('Review not found');
      await this.recalculateHotelRating(review.hotelId, session);
    });
  }

  private async deleteReview(id: string): Promise<void> {
    await this.connection.transaction(async (session) => {
      const review = await this.hotelReviews.findOneAndDelete({ _id: id }, { session }).lean();
      if (!review) throw new NotFoundException('Review not found');
      await this.recalculateHotelRating(review.hotelId, session);
    });
  }

  /** Mirrors HotelReviewsService's own private recalculateHotelRating exactly (same filter/fields) — see class doc. */
  private async recalculateHotelRating(hotelId: Types.ObjectId, session: ClientSession): Promise<void> {
    const [summary] = await this.hotelReviews
      .aggregate<{ averageRating: number; reviewCount: number }>([
        { $match: { hotelId, isHidden: { $ne: true } } },
        { $group: { _id: null, averageRating: { $avg: '$rating' }, reviewCount: { $sum: 1 } } },
      ])
      .session(session)
      .exec();

    await this.hotels
      .updateOne(
        { _id: hotelId },
        { $set: { averageRating: summary?.averageRating ?? null, reviewCount: summary?.reviewCount ?? 0 } },
        { session },
      )
      .exec();
  }

  /** Defense in depth: the global RolesGuard already enforces this at the controller. */
  private assertAdmin(actor: AuthenticatedUser): void {
    if (actor.role !== Role.ADMIN) throw new ForbiddenException('Administrator role required');
  }
}
