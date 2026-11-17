import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsCalendarDate, PaginationDto } from '../../common';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Query of GET /api/hotels/:id/availability (HTL-08). Order and length of the range are checked in the service. */
export class RoomStatusQueryDto extends PaginationDto {
  @ApiProperty({ example: '2027-03-10', description: 'First date of the range, YYYY-MM-DD (included). Past dates are allowed.' })
  @Transform(trim)
  @IsCalendarDate()
  from: string;

  @ApiProperty({ example: '2027-03-16', description: 'Last date of the range, YYYY-MM-DD (included), not before `from`, at most 62 days from `from`.' })
  @Transform(trim)
  @IsCalendarDate()
  to: string;
}
