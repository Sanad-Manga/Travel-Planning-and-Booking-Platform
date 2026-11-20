import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { ErrorResponseDto, Public } from '../common';
import { FreeRoomsQueryDto } from './dto/free-rooms-query.dto';
import { FreeRoomsPageDto } from './dto/free-rooms-response.dto';
import { HotelFreeRoomsService } from './hotel-free-rooms.service';

/** Kept apart from HotelsController/RoomsController and registered first, so no `:id` route can capture this path. */
@ApiTags('hotels')
@Controller('hotels')
export class HotelFreeRoomsController {
  constructor(private readonly freeRooms: HotelFreeRoomsService) {}

  @Get(':id/rooms/available')
  @Public()
  @ApiOperation({
    summary: 'List the rooms of a hotel that are free for the searched dates (public) - HTL-15',
    description:
      'Send checkIn and checkOut (YYYY-MM-DD, checkOut after checkIn, checkIn not in the past). Returns only rooms free for every night of the stay, cheapest first, each with type, beds, maxOccupancy, pricePerNightCents and totalCents (= nights x price per night). The client selects one or more rooms and sends their roomIds to the booking (HTL-16); nothing is held here.',
  })
  @ApiParam({ name: 'id', example: '6730a1f2c3d4e5f607182930', description: 'Hotel id' })
  @ApiOkResponse({ type: FreeRoomsPageDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'Invalid query: missing or impossible date, checkOut not after checkIn, checkIn in the past, bad page/limit (field-level details)',
  })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'The hotel does not exist or is not active' })
  list(@Param('id') id: string, @Query() query: FreeRoomsQueryDto): Promise<FreeRoomsPageDto> {
    return this.freeRooms.listFreeRooms(id, query);
  }
}
