import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthenticatedUser, CurrentUser, ErrorResponseDto, Role, Roles } from '../common';
import { RoomStatusQueryDto } from './dto/room-status-query.dto';
import { RoomStatusPageDto } from './dto/room-status-response.dto';
import { HotelRoomStatusService } from './hotel-room-status.service';

/** Own controller, registered before HotelsController/RoomsController, like the other `:id/...` read routes. */
@ApiTags('hotels')
@ApiCookieAuth()
@Controller('hotels')
export class HotelRoomStatusController {
  constructor(private readonly roomStatus: HotelRoomStatusService) {}

  @Get(':id/availability')
  @Roles(Role.HOTEL_MODERATOR)
  @ApiOperation({
    summary: 'Status of every room of the hotel for a date range (hotel moderator, own hotel only) - HTL-08',
    description:
      'Send from and to (YYYY-MM-DD, both included, to not before from, at most 62 days). Each room returns one entry per date with exactly one status: AVAILABLE (room active, offered for that date, not blocked, not reserved), BOOKED (a confirmed reservation or an unexpired payment hold covers the night; the entry carries the reservation id, reference, status and stay dates; the reference is null while the reservation is only held for payment) or BLOCKED (not sellable and not booked, with blockedReason: ROOM_DEACTIVATED, BLOCKED_RANGE or NOT_OFFERED). A date stands for the night that starts on it. Rooms are paged (page, limit) and ordered by name.',
  })
  @ApiParam({ name: 'id', example: '6730a1f2c3d4e5f607182930', description: "Hotel id (must be the moderator's own hotel)" })
  @ApiOkResponse({ type: RoomStatusPageDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'Missing or impossible date, `to` before `from`, range longer than 62 days, bad page/limit (field-level details)',
  })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto, description: 'Not logged in' })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: "Not a hotel moderator, or not the moderator's own hotel" })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: "The moderator's own hotel no longer exists" })
  list(
    @Param('id') id: string,
    @Query() query: RoomStatusQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<RoomStatusPageDto> {
    return this.roomStatus.getRoomStatus(id, query, user);
  }
}
