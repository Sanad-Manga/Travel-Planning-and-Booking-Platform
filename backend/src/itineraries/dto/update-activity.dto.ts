import { ApiPropertyOptional } from '@nestjs/swagger';
import { ValidateIf } from 'class-validator';
import {
  ACTIVITY_DESCRIPTION_MAX_LENGTH,
  ACTIVITY_NAME_MAX_LENGTH,
} from '../schemas/activity.schema';
import {
  ActivityCostRules,
  ActivityDescriptionRules,
  ActivityNameRules,
  ActivityTimeRule,
  NAME_EXAMPLE,
} from './create-activity.dto';
import { IfSent } from './create-itinerary-day.dto';

/** Validates a field only when it is sent AND not null: on edit, `null` is how time and cost are cleared. */
const IfSentAndNotNull = () =>
  ValidateIf((_object: object, value: unknown) => value != null);

/**
 * Body of PATCH /api/activities/:id (ITN-10). Send at least one field (checked in the service). `time` and
 * `costCents` accept `null` to clear them; the name and description never accept `null`. Written out instead of
 * PartialType, because PartialType's @IsOptional() would let `null` through unvalidated.
 */
export class UpdateActivityDto {
  @ApiPropertyOptional({
    example: NAME_EXAMPLE,
    maxLength: ACTIVITY_NAME_MAX_LENGTH,
  })
  @IfSent()
  @ActivityNameRules()
  name?: string;

  @ApiPropertyOptional({
    maxLength: ACTIVITY_DESCRIPTION_MAX_LENGTH,
    description: 'Free text. Send an empty string to clear it.',
  })
  @ActivityDescriptionRules()
  description?: string;

  @ApiPropertyOptional({
    example: '17:30',
    nullable: true,
    type: String,
    description: 'Start time HH:mm. Send null to clear it.',
  })
  @IfSentAndNotNull()
  @ActivityTimeRule()
  time?: string | null;

  @ApiPropertyOptional({
    example: 2500,
    nullable: true,
    type: Number,
    minimum: 0,
    description: 'Cost in integer cents. Send null to clear it.',
  })
  @IfSentAndNotNull()
  @ActivityCostRules()
  costCents?: number | null;
}
