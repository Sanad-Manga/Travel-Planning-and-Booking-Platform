import { Body, Controller, Delete, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import { AuthenticatedUser, CurrentUser, ErrorResponseDto, Role, Roles } from '../common';
import { AvailabilityResponseDto } from './dto/availability-response.dto';
import { BlockedRangeResponseDto } from './dto/blocked-range-response.dto';
import { CreateAvailabilityDto } from './dto/create-availability.dto';
import { CreateRoomDto } from './dto/create-room.dto';
import { UpdateAvailabilityDto } from './dto/update-availability.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
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

  @Patch(':id/rooms/:roomId')
  @Roles(Role.HOTEL_MODERATOR)
  @ApiOperation({
    summary:
      'Edit a room: any subset of beds, maxOccupancy and pricePerNightCents (hotel moderator, own hotel only). Existing reservations keep the price they were made with.',
  })
  @ApiOkResponse({ type: RoomResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Empty body, invalid value (maxOccupancy < 1, price <= 0 or not an integer), or an unknown field' })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto, description: 'Not logged in' })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: "Not a hotel moderator, or not the moderator's own hotel" })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'The room does not exist in the moderator’s hotel' })
  update(
    @Param('id') id: string,
    @Param('roomId') roomId: string,
    @Body() dto: UpdateRoomDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<RoomResponseDto> {
    return this.roomsService.update(id, roomId, dto, user);
  }

  @Patch(':id/rooms/:roomId/availability')
  @Roles(Role.HOTEL_MODERATOR)
  @ApiExtraModels(AvailabilityResponseDto, BlockedRangeResponseDto, RoomResponseDto)
  @ApiOperation({
    summary:
      'One of three actions per request (hotel moderator, own hotel only). (1) HTL-05, change a range: rangeId plus startDate and/or endDate; dates that stop being available must have no confirmed reservation. (2) HTL-06, block dates: block { startDate, endDate }; rejected if a CONFIRMED reservation or an unexpired PENDING_PAYMENT hold overlaps them. (3) HTL-06, take the room out of sale or back: isActive false/true; deactivating is rejected while such a reservation has not ended yet; inactive rooms are skipped by search.',
  })
  @ApiOkResponse({
    description: '(1) the changed range, (2) the new blocked range, (3) the room.',
    schema: {
      oneOf: [
        { $ref: getSchemaPath(AvailabilityResponseDto) },
        { $ref: getSchemaPath(BlockedRangeResponseDto) },
        { $ref: getSchemaPath(RoomResponseDto) },
      ],
    },
  })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description:
      'Not exactly one action in the body, invalid or missing rangeId/date, endDate not after startDate, no date sent, isActive not a boolean, unknown field',
  })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto, description: 'Not logged in' })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: "Not a hotel moderator, or not the moderator's own hotel" })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'The room or the range does not exist in the moderator’s hotel' })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description:
      'Range edit: overlaps another range, or removes dates that have a confirmed reservation. Block: overlaps a CONFIRMED reservation, an unexpired PENDING_PAYMENT hold or another block. Deactivate: a CONFIRMED reservation or unexpired PENDING_PAYMENT hold has not ended yet',
  })
  updateAvailability(
    @Param('id') id: string,
    @Param('roomId') roomId: string,
    @Body() dto: UpdateAvailabilityDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AvailabilityResponseDto | BlockedRangeResponseDto | RoomResponseDto> {
    return this.roomsService.updateAvailability(id, roomId, dto, user);
  }

  @Delete(':id/rooms/:roomId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Role.HOTEL_MODERATOR)
  @ApiOperation({
    summary:
      'Delete a room (hotel moderator, own hotel only). Allowed only for a room that was never reserved (no reservation of any status mentions it); otherwise deactivate it with PATCH .../availability { isActive: false }.',
  })
  @ApiNoContentResponse({ description: 'The room is deleted' })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto, description: 'Not logged in' })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: "Not a hotel moderator, or not the moderator's own hotel" })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'The room does not exist in the moderator’s hotel' })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'The room has been reserved before (any status)' })
  remove(@Param('id') id: string, @Param('roomId') roomId: string, @CurrentUser() user: AuthenticatedUser): Promise<void> {
    return this.roomsService.remove(id, roomId, user);
  }
}
