import { ApiProperty } from '@nestjs/swagger';
import { IsCalendarDate } from '../../common';

export class AdminAnalyticsQueryDto {
  @ApiProperty({
    type: String,
    format: 'date',
    example: '2026-11-01',
    description: 'First UTC booking creation date, inclusive.',
  })
  @IsCalendarDate()
  dateFrom: string;

  @ApiProperty({
    type: String,
    format: 'date',
    example: '2026-11-30',
    description: 'Last UTC booking creation date, inclusive.',
  })
  @IsCalendarDate()
  dateTo: string;
}
