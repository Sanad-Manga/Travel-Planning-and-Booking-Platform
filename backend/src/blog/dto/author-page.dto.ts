import { ApiProperty } from '@nestjs/swagger';
import { PublicItineraryRowDto } from '../../itineraries/dto/public-itinerary-row.dto';
import { PostListRowDto } from './post-list-row.dto';

/** The page fields every paginated list has (contracts section 3). */
class PageFieldsDto {
  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 10 })
  limit: number;

  @ApiProperty({ example: 1 })
  total: number;

  @ApiProperty({ example: 1 })
  totalPages: number;
}

/** One page of the author's published posts. Same rows as GET /api/posts. */
export class AuthorPostsPageDto extends PageFieldsDto {
  @ApiProperty({ type: [PostListRowDto] })
  items: PostListRowDto[];
}

/** One page of the author's public itineraries. Same rows as GET /api/itineraries/public/search. */
export class AuthorItinerariesPageDto extends PageFieldsDto {
  @ApiProperty({ type: [PublicItineraryRowDto] })
  items: PublicItineraryRowDto[];
}

/**
 * GET /api/authors/:id (BLG-12). Only public profile fields: id, name and join date.
 * Never email, role, status, password hash or tokens.
 */
export class AuthorPageDto {
  @ApiProperty({ example: '6730a1f2c3d4e5f607182900' })
  id: string;

  @ApiProperty({ example: 'Sara Ahmed' })
  name: string;

  @ApiProperty({ example: '2026-10-01T09:00:00.000Z', description: 'When the account was created (join date).' })
  joinedAt: string;

  @ApiProperty({ type: AuthorPostsPageDto, description: 'Published, not hidden posts, newest published first.' })
  posts: AuthorPostsPageDto;

  @ApiProperty({ type: AuthorItinerariesPageDto, description: 'Public, not hidden itineraries, most recently updated first.' })
  itineraries: AuthorItinerariesPageDto;
}
