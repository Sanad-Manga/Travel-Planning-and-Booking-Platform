import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId, ValidateIf } from 'class-validator';

/** Body of PATCH /api/posts/:id/itinerary (BLG-13). */
export class AttachItineraryDto {
  @ApiProperty({
    type: String,
    nullable: true,
    example: '674a1b2c3d4e5f6a7b8c9d0e',
    description: 'One of your own itineraries. null removes the attached itinerary.',
  })
  // null is allowed (detach); anything else, a missing field included, must be a valid id.
  @ValidateIf((_object, value) => value !== null)
  @IsMongoId()
  itineraryId: string | null;
}
