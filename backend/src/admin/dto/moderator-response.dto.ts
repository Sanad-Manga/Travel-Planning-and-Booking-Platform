import { ApiPropertyOptional } from '@nestjs/swagger';
import { AccountResponseDto } from './account-response.dto';

/** 201 body of POST /api/admin/moderators: the ACC-14 account shape plus the ONE linked provider id. */
export class ModeratorResponseDto extends AccountResponseDto {
  @ApiPropertyOptional({ description: 'Linked airline. Present only for AIRLINE_MODERATOR.' })
  airlineId?: string;

  @ApiPropertyOptional({ description: 'Linked hotel. Present only for HOTEL_MODERATOR.' })
  hotelId?: string;
}
