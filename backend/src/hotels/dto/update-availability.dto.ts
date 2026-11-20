import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsMongoId, IsOptional, ValidateIf, ValidateNested } from 'class-validator';
import { IsCalendarDate } from '../../common';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** HTL-06: the dates to take out of sale. Half-open like every range: endDate is the day the block ends (not blocked). */
export class BlockRangeDto {
  @ApiProperty({ description: 'First blocked night, YYYY-MM-DD.', example: '2026-12-20' })
  @Transform(trim)
  @IsCalendarDate()
  startDate: string;

  @ApiProperty({
    description: 'First day that is NOT blocked again, YYYY-MM-DD, must be after startDate (the block is [startDate, endDate)).',
    example: '2026-12-23',
  })
  @Transform(trim)
  @IsCalendarDate()
  endDate: string;
}

/**
 * PATCH .../rooms/:roomId/availability. One endpoint, three mutually exclusive actions (docs/contracts.md section 12
 * lists HTL-05 and HTL-06 on this route). Exactly one group must be sent; the service answers 400 otherwise:
 *  - HTL-05, change a range:    rangeId + startDate and/or endDate
 *  - HTL-06, block dates:       block { startDate, endDate }
 *  - HTL-06, (de)activate room: isActive
 */
export class UpdateAvailabilityDto {
  @ApiPropertyOptional({ description: 'HTL-05: id of the availability range to change (returned by HTL-04).', example: '6730a1f2c3d4e5f607182950' })
  @ValidateIf((_, value) => value !== undefined) // not IsOptional: it would also let `null` through
  @IsMongoId()
  rangeId?: string;

  @ApiPropertyOptional({ description: 'HTL-05: new first bookable night, YYYY-MM-DD. Omit to keep the current one.', example: '2026-12-03' })
  @IsOptional()
  @Transform(trim)
  @IsCalendarDate()
  startDate?: string;

  @ApiPropertyOptional({
    description: 'HTL-05: new check-out day, YYYY-MM-DD, must be after the (new) startDate. Omit to keep the current one.',
    example: '2026-12-12',
  })
  @IsOptional()
  @Transform(trim)
  @IsCalendarDate()
  endDate?: string;

  @ApiPropertyOptional({
    type: BlockRangeDto,
    description:
      'HTL-06: block these dates for the room. Rejected (409) if a CONFIRMED reservation or an unexpired PENDING_PAYMENT hold overlaps them, or if they overlap an existing block.',
  })
  @ValidateIf((_, value) => value !== undefined) // `null` must be a 400, not "no block sent"
  @ValidateNested()
  @Type(() => BlockRangeDto)
  block?: BlockRangeDto;

  @ApiPropertyOptional({
    description:
      'HTL-06: false takes the room out of search and booking; true puts it back. Deactivating is rejected (409) while a CONFIRMED reservation or an unexpired PENDING_PAYMENT hold has not ended yet.',
    example: false,
  })
  @ValidateIf((_, value) => value !== undefined) // `null` must be a 400, otherwise it would be stored as isActive
  @IsBoolean()
  isActive?: boolean;
}
