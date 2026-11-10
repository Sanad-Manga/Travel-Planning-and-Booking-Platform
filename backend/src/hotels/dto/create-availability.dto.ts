import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsCalendarDate } from '../../common';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateAvailabilityDto {
  @ApiProperty({ description: 'First bookable night (check-in day), YYYY-MM-DD.', example: '2026-12-01' })
  @Transform(trim)
  @IsCalendarDate()
  startDate: string;

  @ApiProperty({
    description: 'Check-out day, YYYY-MM-DD, must be after startDate. The night of endDate itself is NOT included (the range is [startDate, endDate)).',
    example: '2026-12-15',
  })
  @Transform(trim)
  @IsCalendarDate()
  endDate: string;
}
