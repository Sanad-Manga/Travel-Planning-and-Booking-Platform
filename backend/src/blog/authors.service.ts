import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, ProjectionType, Types } from 'mongoose';
import { AccountStatus, paginate, PaginationDto, PostStatus, toPaginated, Visibility } from '../common';
import { toPublicItineraryRow } from '../itineraries/dto/public-itinerary-row.dto';
import { Itinerary } from '../itineraries/schemas/itinerary.schema';
import { UsersService } from '../users/users.service';
import { AuthorPageDto } from './dto/author-page.dto';
import { POST_LIST_ROW_PROJECTION, PostListRowDto } from './dto/post-list-row.dto';
import { Post } from './schemas/post.schema';

/**
 * BLG-12: the public author page. Read only: it never changes users, posts or itineraries.
 * The user is read through UsersService; itineraries are read through the Itinerary model (registered read-only
 * in BlogModule), because ItinerariesModule has no "public itineraries of one author" method yet.
 */
@Injectable()
export class AuthorsService {
  constructor(
    @InjectModel(Post.name) private readonly posts: Model<Post>,
    @InjectModel(Itinerary.name) private readonly itineraries: Model<Itinerary>,
    private readonly users: UsersService,
  ) {}

  /**
   * Open to guests. A deactivated, unknown or malformed id is the same 404, so the page never reveals
   * that a deactivated account exists. `query` (page, limit) applies to both lists.
   */
  async findOne(id: string, query: PaginationDto): Promise<AuthorPageDto> {
    // A malformed id can never match a user: same 404 as an unknown one (no CastError reaches the client).
    if (!/^[0-9a-f]{24}$/i.test(id)) throw new NotFoundException('Author not found');
    const user = await this.users.findById(id);
    if (!user || user.status === AccountStatus.DEACTIVATED) throw new NotFoundException('Author not found');

    const authorId = new Types.ObjectId(id);
    const author = { id, name: user.name };

    // Same rules as the public post list (BLG-02): only PUBLISHED and not hidden, newest published first.
    const postsPage = await paginate(this.posts, { authorId, status: PostStatus.PUBLISHED, isHidden: false }, query, {
      map: (doc) => ({ ...PostListRowDto.fromLean(doc), author }),
      sort: { publishedAt: -1, _id: -1 },
      // Mongoose's types do not know aggregation expressions in a find projection, MongoDB does.
      projection: POST_LIST_ROW_PROJECTION as unknown as ProjectionType<Post>,
    });

    // Same rules as the public itinerary search (ITN-20): PUBLIC, not hidden, and only while the author is ACTIVE
    // (so a SUSPENDED author's page lists no itineraries, matching GET /api/itineraries/public/:id, which 404s them).
    const itinerariesPage =
      user.status === AccountStatus.ACTIVE
        ? await paginate(this.itineraries, { authorId, visibility: Visibility.PUBLIC, isHidden: false }, query, {
            map: toPublicItineraryRow,
            sort: { updatedAt: -1, _id: -1 },
          })
        : toPaginated([], 0, query.page, query.limit);

    return {
      id,
      name: user.name,
      joinedAt: (user.createdAt ?? new Date(0)).toISOString(),
      posts: postsPage,
      itineraries: itinerariesPage,
    };
  }
}
