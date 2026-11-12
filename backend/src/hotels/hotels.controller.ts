import { Body, Controller, Param, Patch, Post, Put } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthenticatedUser, CurrentUser, ErrorResponseDto, Role, Roles } from '../common';
import { CreateHotelDto } from './dto/create-hotel.dto';
import { HotelPoliciesResponseDto } from './dto/hotel-policies-response.dto';
import { HotelResponseDto } from './dto/hotel-response.dto';
import { UpdateHotelDto } from './dto/update-hotel.dto';
import { UpdateHotelPoliciesDto } from './dto/update-hotel-policies.dto';
import { HotelsService } from './hotels.service';

@ApiTags('hotels')
@ApiCookieAuth()
@Controller('hotels')
export class HotelsController {
  constructor(private readonly hotelsService: HotelsService) {}

  @Post()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Create a hotel (admin only). Linking a moderator to it is ACC-13.' })
  @ApiCreatedResponse({ type: HotelResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Invalid field, unknown cityId, or more than 5 photos' })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto, description: 'Not logged in' })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'Not an admin' })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'A hotel with this name already exists in this city' })
  create(@Body() dto: CreateHotelDto, @CurrentUser() user: AuthenticatedUser): Promise<HotelResponseDto> {
    return this.hotelsService.create(dto, user);
  }

  @Patch(':id')
  @Roles(Role.HOTEL_MODERATOR)
  @ApiOperation({ summary: 'Edit the hotel profile (hotel moderator, own hotel only). Send any subset of the fields.' })
  @ApiOkResponse({ type: HotelResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Empty body, invalid field, unknown cityId, or more than 5 photos' })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto, description: 'Not logged in' })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: "Not a hotel moderator, or not the moderator's own hotel" })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: "The moderator's own hotel no longer exists" })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'A hotel with this name already exists in this city' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateHotelDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<HotelResponseDto> {
    return this.hotelsService.update(id, dto, user);
  }

  @Put(':id/policies')
  @Roles(Role.HOTEL_MODERATOR)
  @ApiOperation({
    summary:
      'Set the cancellation tiers of the hotel (hotel moderator, own hotel only). The list is replaced as a whole. A tier says: cancelling at least daysBeforeThreshold days before check-in refunds refundPercent %. Thresholds must be unique.',
  })
  @ApiOkResponse({ type: HotelPoliciesResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'Missing or invalid list, threshold < 0 or not a whole number, percent outside 0-100, duplicate threshold, too many tiers, unknown field',
  })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto, description: 'Not logged in' })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: "Not a hotel moderator, or not the moderator's own hotel" })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: "The moderator's own hotel no longer exists" })
  updatePolicies(
    @Param('id') id: string,
    @Body() dto: UpdateHotelPoliciesDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<HotelPoliciesResponseDto> {
    return this.hotelsService.updatePolicies(id, dto, user);
  }
}
