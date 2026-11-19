import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import {
  BookingStatus,
  BookingType,
  IsCalendarDate,
  PaginationDto,
} from '../../common';

export class AdminBookingsQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: BookingType })
  @IsOptional()
  @IsEnum(BookingType)
  type?: BookingType;

  @ApiPropertyOptional({ enum: BookingStatus })
  @IsOptional()
  @IsEnum(BookingStatus)
  status?: BookingStatus;

  @ApiPropertyOptional({
    type: String,
    format: 'date',
    description: 'First UTC booking creation date, inclusive.',
  })
  @IsOptional()
  @IsCalendarDate()
  dateFrom?: string;

  @ApiPropertyOptional({
    type: String,
    format: 'date',
    description: 'Last UTC booking creation date, inclusive.',
  })
  @IsOptional()
  @IsCalendarDate()
  dateTo?: string;
}
