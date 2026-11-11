import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  ACTIVITY_DESCRIPTION_MAX_LENGTH,
  ACTIVITY_NAME_MAX_LENGTH,
} from '../schemas/activity.schema';
import { IfSent } from './create-itinerary-day.dto';

/** Safety cap on one activity cost (1 billion units of the platform currency), far above any real cost. */
export const ACTIVITY_COST_MAX_CENTS = 100_000_000_000;
/** `HH:mm` on a 24-hour clock, e.g. 08:30 or 23:59. */
export const ACTIVITY_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** The rules for the name: required on add, validated when sent on edit (`null` is never accepted). */
export const ActivityNameRules = () =>
  applyDecorators(
    Transform(trim),
    IsString({ message: 'name must be a string' }),
    IsNotEmpty({ message: 'name should not be empty' }),
    MaxLength(ACTIVITY_NAME_MAX_LENGTH, {
      message: `name must be at most ${ACTIVITY_NAME_MAX_LENGTH} characters`,
    }),
  );

/** The rules for the description, when sent. An empty string clears it; `null` is rejected. */
export const ActivityDescriptionRules = () =>
  applyDecorators(
    IfSent(),
    Transform(trim),
    IsString({ message: 'description must be a string' }),
    MaxLength(ACTIVITY_DESCRIPTION_MAX_LENGTH, {
      message: `description must be at most ${ACTIVITY_DESCRIPTION_MAX_LENGTH} characters`,
    }),
  );

/** The rule for the time: `HH:mm`. The caller decides how `null` is handled (add rejects it, edit clears it). */
export const ActivityTimeRule = () =>
  applyDecorators(
    Matches(ACTIVITY_TIME_PATTERN, {
      message: 'time must be HH:mm on a 24-hour clock, e.g. 08:30',
    }),
  );

/** The rule for the cost: a non-negative whole number of cents. */
export const ActivityCostRules = () =>
  applyDecorators(
    IsInt({ message: 'costCents must be a whole number of cents' }),
    Min(0, { message: 'costCents must not be negative' }),
    Max(ACTIVITY_COST_MAX_CENTS, {
      message: `costCents must be at most ${ACTIVITY_COST_MAX_CENTS}`,
    }),
  );

export const NAME_EXAMPLE = 'Pyramids of Giza';

/**
 * Body of POST /api/itineraries/:id/days/:dayId/activities (ITN-10). Only the name is required. The itinerary,
 * the day and the owner come from the URL and the login, never from the body.
 */
export class CreateActivityDto {
  @ApiProperty({
    example: NAME_EXAMPLE,
    maxLength: ACTIVITY_NAME_MAX_LENGTH,
  })
  @ActivityNameRules()
  name: string;

  @ApiPropertyOptional({
    example: 'Early morning, before the crowds',
    maxLength: ACTIVITY_DESCRIPTION_MAX_LENGTH,
  })
  @ActivityDescriptionRules()
  description?: string;

  @ApiPropertyOptional({
    example: '08:30',
    description: 'Start time HH:mm on a 24-hour clock',
  })
  @IfSent()
  @ActivityTimeRule()
  time?: string;

  @ApiPropertyOptional({
    example: 3500,
    minimum: 0,
    description: 'Cost in integer cents of the platform currency. 0 is free.',
  })
  @IfSent()
  @ActivityCostRules()
  costCents?: number;
}
