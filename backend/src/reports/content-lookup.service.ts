import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Post } from '../blog/schemas/post.schema';
import { ContentType, PostStatus, Visibility } from '../common';
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
  ) {}

  /**
   * @returns true when the item exists and is reportable, false when it does not.
   * @throws BadRequestException for a type whose module does not exist yet (comments BLG-06, reviews HTL-23): the
   *   type is a valid ContentType, but nothing can be reported until its owner's module lands and is added here.
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
