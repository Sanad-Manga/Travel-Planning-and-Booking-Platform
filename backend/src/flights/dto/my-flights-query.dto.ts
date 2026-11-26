import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { FlightStatus, PaginationDto } from '../../common';

/** `GET /api/flights/mine?page=1&limit=10&status=SCHEDULED`. */
export class MyFlightsQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    enum: FlightStatus,
    description:
      'Return only flights with this status. A SCHEDULED flight whose departure time has passed counts as DEPARTED. Omit it to list every flight of the airline.',
  })
  @IsOptional()
  @IsEnum(FlightStatus, {
    message: 'status must be SCHEDULED, CANCELLED or DEPARTED',
  })
  status?: FlightStatus;
}
