import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsMongoId, IsOptional } from 'class-validator';
import { IsDateOnly } from './is-date-only.decorator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class UpdateAvailabilityDto {
  @ApiProperty({ description: 'Id of the availability range to change (returned by HTL-04).', example: '6730a1f2c3d4e5f607182950' })
  @IsMongoId()
  rangeId: string;

  @ApiPropertyOptional({ description: 'New first bookable night, YYYY-MM-DD. Omit to keep the current one.', example: '2026-12-03' })
  @IsOptional()
  @Transform(trim)
  @IsDateOnly()
  startDate?: string;

  @ApiPropertyOptional({
    description: 'New check-out day, YYYY-MM-DD, must be after the (new) startDate. Omit to keep the current one.',
    example: '2026-12-12',
  })
  @IsOptional()
  @Transform(trim)
  @IsDateOnly()
  endDate?: string;
}
