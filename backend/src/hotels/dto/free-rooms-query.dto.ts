import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsCalendarDate, PaginationDto } from '../../common';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Query of GET /api/hotels/:id/rooms/available (HTL-15). The date order and "not in the past" are checked in the service. */
export class FreeRoomsQueryDto extends PaginationDto {
  @ApiProperty({ example: '2027-03-10', description: 'First night, YYYY-MM-DD. Today or later (UTC).' })
  @Transform(trim)
  @IsCalendarDate()
  checkIn: string;

  @ApiProperty({ example: '2027-03-13', description: 'Check-out day, YYYY-MM-DD, after checkIn. It is not a night of the stay.' })
  @Transform(trim)
  @IsCalendarDate()
  checkOut: string;
}
