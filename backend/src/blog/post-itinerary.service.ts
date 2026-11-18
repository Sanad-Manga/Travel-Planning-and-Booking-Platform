import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuthenticatedUser, Visibility } from '../common';
import { PublicItineraryRowDto, toPublicItineraryRow } from '../itineraries/dto/public-itinerary-row.dto';
import { Itinerary, ItineraryLean } from '../itineraries/schemas/itinerary.schema';
import { UsersService } from '../users/users.service';
import { PostResponseDto } from './dto/post-response.dto';
import { Post } from './schemas/post.schema';

const OBJECT_ID = /^[0-9a-f]{24}$/i;

/**
 * BLG-13: the author attaches one of their own itineraries to their own post, and readers see it only while it is
 * public. Itineraries are read through the Itinerary model registered read-only in BlogModule (as for BLG-12);
 * Blog never writes to that collection.
 */
@Injectable()
export class PostItineraryService {
  constructor(
    @InjectModel(Post.name) private readonly posts: Model<Post>,
    @InjectModel(Itinerary.name) private readonly itineraries: Model<Itinerary>,
    private readonly users: UsersService,
  ) {}

  /**
   * Attach (or, with null, remove) the itinerary. 404 for a missing post or someone else's post, then 404 for an
   * itinerary that does not exist or is not the caller's own (private or public alike). A private itinerary may be
   * attached: readers simply do not see it until it becomes public. The write is filtered on the post id AND the author
   * again, so a post deleted in between gives 404 instead of a silent no-op.
   */
  async attach(id: string, itineraryId: string | null, actor: AuthenticatedUser): Promise<PostResponseDto> {
    if (!OBJECT_ID.test(id)) throw new NotFoundException('Post not found');
    const authorId = new Types.ObjectId(actor.userId);
    const filter = { _id: new Types.ObjectId(id), authorId };
    if (!(await this.posts.exists(filter))) throw new NotFoundException('Post not found');

    if (itineraryId !== null) {
      const own = await this.itineraries.exists({ _id: new Types.ObjectId(itineraryId), authorId });
      if (!own) throw new NotFoundException('Itinerary not found');
    }

    const update = itineraryId === null ? { $unset: { itineraryId: 1 } } : { $set: { itineraryId: new Types.ObjectId(itineraryId) } };
    const post = await this.posts.findOneAndUpdate(filter, update, { new: true });
    if (!post) throw new NotFoundException('Post not found');
    return PostResponseDto.from(post);
  }

  /**
   * The attached itinerary as GET /api/posts/:id shows it, or null. Readers see it only when it is PUBLIC, not hidden
   * and its author is ACTIVE: the same rule as GET /api/itineraries/public/:id (ITN-20/21), so the post never links
   * to an itinerary that would 404. An itinerary deleted after it was attached is simply null.
   * GET /api/posts/:id is a public route, so it does not know who is reading: the author sees the same as everyone
   * (they get the attached id back from PATCH /api/posts/:id/itinerary).
   */
  async visibleItinerary(itineraryId?: Types.ObjectId): Promise<PublicItineraryRowDto | null> {
    if (!itineraryId) return null;
    const itinerary = await this.itineraries
      .findOne({ _id: itineraryId, visibility: Visibility.PUBLIC, isHidden: false })
      .lean<ItineraryLean>()
      .exec();
    if (!itinerary || !(await this.users.isActive(itinerary.authorId.toString()))) return null;
    return toPublicItineraryRow(itinerary);
  }
}
