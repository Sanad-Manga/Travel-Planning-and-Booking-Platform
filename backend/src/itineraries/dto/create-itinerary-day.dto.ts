import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/** Longest notes text for one day. Not set by the requirements; a safety cap for the stored document. */
export const ITINERARY_DAY_NOTES_MAX_LENGTH = 2000;
/** Longer than any official city_id. Stops a huge string from reaching the lookup. */
export const CITY_ID_MAX_LENGTH = 100;

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Body of POST /api/itineraries/:id/days (ITN-05). The new day is added at the end; its number and date
 * are derived by the server.
 */
export class CreateItineraryDayDto {
  @ApiProperty({
    example: 'cairo',
    description:
      'Official city_id from the seeded city list (the one hotels and airports use)',
  })
  @Transform(trim)
  @IsString({ message: 'cityId must be a string' })
  @IsNotEmpty({ message: 'cityId should not be empty' })
  @MaxLength(CITY_ID_MAX_LENGTH, {
    message: `cityId must be at most ${CITY_ID_MAX_LENGTH} characters`,
  })
  cityId: string;

  @ApiPropertyOptional({
    example: 'Pyramids of Giza in the morning',
    maxLength: ITINERARY_DAY_NOTES_MAX_LENGTH,
    description: 'Free text. Empty when not sent.',
  })
  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'notes must be a string' })
  @MaxLength(ITINERARY_DAY_NOTES_MAX_LENGTH, {
    message: `notes must be at most ${ITINERARY_DAY_NOTES_MAX_LENGTH} characters`,
  })
  notes?: string;
}
