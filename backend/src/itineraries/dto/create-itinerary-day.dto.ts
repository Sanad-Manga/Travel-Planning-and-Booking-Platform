import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength, ValidateIf } from 'class-validator';

/** Longest notes text for one day. Not set by the requirements; a safety cap for the stored document. */
export const ITINERARY_DAY_NOTES_MAX_LENGTH = 2000;
/** Longer than any official city_id. Stops a huge string from reaching the lookup. */
export const CITY_ID_MAX_LENGTH = 100;

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Validates a field only when it was sent. Unlike @IsOptional(), `null` is still validated (and rejected
 * as not a string), so it can never be stored.
 */
export const IfSent = () =>
  ValidateIf((_object: object, value: unknown) => value !== undefined);

/** The rules for a day's city, shared by add (required) and edit (optional). */
export const CityIdRules = () =>
  applyDecorators(
    Transform(trim),
    IsString({ message: 'cityId must be a string' }),
    IsNotEmpty({ message: 'cityId should not be empty' }),
    MaxLength(CITY_ID_MAX_LENGTH, {
      message: `cityId must be at most ${CITY_ID_MAX_LENGTH} characters`,
    }),
  );

/** The rules for a day's notes, when they are sent. */
export const NotesRules = () =>
  applyDecorators(
    IfSent(),
    Transform(trim),
    IsString({ message: 'notes must be a string' }),
    MaxLength(ITINERARY_DAY_NOTES_MAX_LENGTH, {
      message: `notes must be at most ${ITINERARY_DAY_NOTES_MAX_LENGTH} characters`,
    }),
  );

export const CITY_ID_DESCRIPTION =
  'Official city_id from the seeded city list (the one hotels and airports use)';
export const NOTES_EXAMPLE = 'Pyramids of Giza in the morning';

/**
 * Body of POST /api/itineraries/:id/days (ITN-05). The new day is added at the end; its number and date
 * are derived by the server.
 */
export class CreateItineraryDayDto {
  @ApiProperty({ example: 'cairo', description: CITY_ID_DESCRIPTION })
  @CityIdRules()
  cityId: string;

  @ApiPropertyOptional({
    example: NOTES_EXAMPLE,
    maxLength: ITINERARY_DAY_NOTES_MAX_LENGTH,
    description: 'Free text. Empty when not sent.',
  })
  @NotesRules()
  notes?: string;
}
