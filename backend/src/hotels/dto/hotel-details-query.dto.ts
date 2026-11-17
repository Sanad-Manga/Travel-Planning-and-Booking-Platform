import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional } from 'class-validator';
import { IsCalendarDate, PaginationDto } from '../../common';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/**
 * Query of GET /api/hotels/:id (HTL-02). Both dates are optional, but they come as a pair (checked in the service,
 * with the same date-order rules as HTL-15). `page` and `limit` page the free rooms, and only matter with dates.
 */
export class HotelDetailsQueryDto extends PaginationDto {
  @ApiPropertyOptional({ example: '2027-03-10', description: 'First night, YYYY-MM-DD. Send together with checkOut to get the free rooms.' })
  @IsOptional()
  @Transform(trim)
  @IsCalendarDate()
  checkIn?: string;

  @ApiPropertyOptional({ example: '2027-03-13', description: 'Check-out day, YYYY-MM-DD, after checkIn. Send together with checkIn.' })
  @IsOptional()
  @Transform(trim)
  @IsCalendarDate()
  checkOut?: string;
}
