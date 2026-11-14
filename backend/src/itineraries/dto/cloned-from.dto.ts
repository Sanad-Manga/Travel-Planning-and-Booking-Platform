import { ApiProperty } from '@nestjs/swagger';
import { ClonedFrom } from '../schemas/itinerary.schema';

/** The credit on a clone (ITN-21): the itinerary it was copied from and the author of that itinerary. */
export class ClonedFromDto {
  @ApiProperty({
    example: '674a1b2c3d4e5f6a7b8c9d0e',
    description:
      'The itinerary that was copied. It may have been deleted or made private since.',
  })
  itineraryId: string;

  @ApiProperty({
    example: '674a1b2c3d4e5f6a7b8c9d0f',
    description: 'The author of the original itinerary (a user id)',
  })
  authorId: string;

  @ApiProperty({
    example: 'Alice Author',
    description: "The original author's name when the copy was made",
  })
  authorName: string;
}

/** `null` for an itinerary that is not a clone. */
export function toClonedFrom(doc?: ClonedFrom | null): ClonedFromDto | null {
  if (!doc) return null;
  return {
    itineraryId: doc.itineraryId.toString(),
    authorId: doc.authorId.toString(),
    authorName: doc.authorName,
  };
}
