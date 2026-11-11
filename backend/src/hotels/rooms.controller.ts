import { Body, Controller, Param, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthenticatedUser, CurrentUser, ErrorResponseDto, Role, Roles } from '../common';
import { AvailabilityResponseDto } from './dto/availability-response.dto';
import { CreateAvailabilityDto } from './dto/create-availability.dto';
import { CreateRoomDto } from './dto/create-room.dto';
import { RoomResponseDto } from './dto/room-response.dto';
import { RoomsService } from './rooms.service';

@ApiTags('hotels')
@ApiCookieAuth()
@Controller('hotels')
export class RoomsController {
  constructor(private readonly roomsService: RoomsService) {}

  @Post(':id/rooms')
  @Roles(Role.HOTEL_MODERATOR)
  @ApiOperation({ summary: 'Add a room to a hotel (hotel moderator, own hotel only). The room number/name must be unique within the hotel.' })
  @ApiCreatedResponse({ type: RoomResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Missing or invalid field: maxOccupancy < 1, pricePerNightCents <= 0 or not an integer, unknown field' })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto, description: 'Not logged in' })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: "Not a hotel moderator, or not the moderator's own hotel" })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'A room with this number or name already exists in this hotel' })
  create(
    @Param('id') id: string,
    @Body() dto: CreateRoomDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<RoomResponseDto> {
    return this.roomsService.create(id, dto, user);
  }

  @Post(':id/rooms/:roomId/availability')
  @Roles(Role.HOTEL_MODERATOR)
  @ApiOperation({
    summary:
      'Define a date range when a room is bookable (hotel moderator, own hotel only). Dates are YYYY-MM-DD and the range is [startDate, endDate): endDate is the check-out day. Ranges of one room must not overlap; adjacent ranges are fine.',
  })
  @ApiCreatedResponse({ type: AvailabilityResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Invalid or missing date, endDate not after startDate, unknown field' })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto, description: 'Not logged in' })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: "Not a hotel moderator, or not the moderator's own hotel" })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'The room does not exist in the moderator’s hotel' })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'The range overlaps an existing range of the room, or the room already has the maximum number of ranges' })
  addAvailability(
    @Param('id') id: string,
    @Param('roomId') roomId: string,
    @Body() dto: CreateAvailabilityDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AvailabilityResponseDto> {
    return this.roomsService.addAvailability(id, roomId, dto, user);
  }
}
