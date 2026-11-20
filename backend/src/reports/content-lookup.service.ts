import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Comment } from '../blog/schemas/comment.schema';
import { Post } from '../blog/schemas/post.schema';
import { ContentType, PostStatus, Visibility } from '../common';
import { HotelReview } from '../hotels/schemas/hotel-review.schema';
import { Itinerary } from '../itineraries/schemas/itinerary.schema';

/**
 * "Does this item exist, and may the reporter see it?" by type + id, for GEN-09. Read-only: it never writes to
 * another module's collection. An item the reporter could not see (a draft, a private itinerary, hidden content)
 * counts as not found, so a report cannot be used to probe for it (contracts section 3: 404 for private resources).
 */
@Injectable()
export class ContentLookupService {
  constructor(
    @InjectModel(Post.name) private readonly posts: Model<Post>,
    @InjectModel(Itinerary.name) private readonly itineraries: Model<Itinerary>,
    @InjectModel(Comment.name) private readonly comments: Model<Comment>,
    @InjectModel(HotelReview.name)
    private readonly reviews: Model<HotelReview>,
  ) {}

  /**
   * @returns true when the item exists and is reportable, false when it does not. A comment is reportable while it
   *   is not hidden and its post is published and not hidden; a review while it is not hidden.
   * @throws BadRequestException for a type that is not reportable at all (none left today: every ContentType is handled).
   */
  async isReportable(type: ContentType, id: string): Promise<boolean> {
    switch (type) {
      case ContentType.POST:
        return !!(await this.posts.exists({
          _id: id,
          status: PostStatus.PUBLISHED,
          isHidden: { $ne: true },
        }));
      case ContentType.ITINERARY:
        return !!(await this.itineraries.exists({
          _id: id,
          visibility: Visibility.PUBLIC,
          isHidden: { $ne: true },
        }));
      case ContentType.COMMENT: {
        if (!Types.ObjectId.isValid(id)) return false;
        const comment = await this.comments
          .findOne({ _id: id, isHidden: { $ne: true } })
          .select('postId')
          .lean<{ postId: Types.ObjectId }>()
          .exec();
        if (!comment) return false;
        return !!(await this.posts.exists({
          _id: comment.postId,
          status: PostStatus.PUBLISHED,
          isHidden: { $ne: true },
        }));
      }
      case ContentType.REVIEW:
        return !!(await this.reviews.exists({
          _id: id,
          isHidden: { $ne: true },
        }));
      default:
        throw new BadRequestException({
          message: 'Validation failed',
          details: [
            { field: 'targetType', message: `${type} cannot be reported yet` },
          ],
        });
    }
  }
}
