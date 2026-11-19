import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiInternalServerErrorResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  ApiPaginatedResponse,
  AuthenticatedUser,
  CurrentUser,
  ErrorResponseDto,
  Role,
  Roles,
} from '../common';
import { AdminBookingsService } from './admin-bookings.service';
import { AdminBookingResponseDto } from './dto/admin-booking-response.dto';
import { AdminBookingsQueryDto } from './dto/admin-bookings-query.dto';

@ApiTags('admin')
@ApiCookieAuth()
@Roles(Role.ADMIN)
@Controller('admin/bookings')
export class AdminBookingsController {
  constructor(private readonly bookings: AdminBookingsService) {}

  @Get()
  @ApiOperation({
    summary: 'List flight and hotel bookings (ADMIN only)',
    description:
      'One read-only list, newest booking first. Filters combine with AND. Date bounds include the entire UTC calendar day of booking creation.',
  })
  @ApiPaginatedResponse(AdminBookingResponseDto)
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'Invalid pagination, date range or filter.',
  })
  @ApiUnauthorizedResponse({
    type: ErrorResponseDto,
    description: 'Missing, expired or inactive authentication.',
  })
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description: 'Administrator role required.',
  })
  @ApiInternalServerErrorResponse({
    type: ErrorResponseDto,
    description: 'Booking list could not be retrieved.',
  })
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: AdminBookingsQueryDto,
  ) {
    return this.bookings.list(actor, query);
  }
}
