import { Controller, Get, Param, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthenticatedUser, CurrentUser, ErrorResponseDto, Role, Roles } from '../common';
import { BookingPoliciesResponseDto } from './dto/booking-policies-response.dto';
import { PolicyAcceptanceResponseDto } from './dto/policy-acceptance-response.dto';
import { PolicyAcceptanceService } from './policy-acceptance.service';

@ApiTags('booking-policies')
@ApiCookieAuth()
@ApiUnauthorizedResponse({
  type: ErrorResponseDto,
  description: 'Not logged in',
})
@Controller('bookings')
export class BookingPoliciesController {
  constructor(private readonly policies: PolicyAcceptanceService) {}

  @Get(':type/:id/policies')
  @Roles(Role.USER)
  @ApiOperation({
    summary: "Show the booking's provider policies before payment - PAY-02",
    description:
      'FLIGHT: cancellation tiers and baggage policy. HOTEL: cancellation tiers and check-in/out times. ' +
      'Only the booking owner may view them.',
  })
  @ApiOkResponse({ type: BookingPoliciesResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: ':type must be FLIGHT or HOTEL',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description:
      'The booking is unknown, belongs to another traveler, or that booking type has no provider yet',
  })
  getPolicies(
    @CurrentUser() user: AuthenticatedUser,
    @Param('type') type: string,
    @Param('id') id: string,
  ) {
    return this.policies.getPolicies(user, type, id);
  }

  @Post(':type/:id/accept-policies')
  @Roles(Role.USER)
  @ApiOperation({
    summary: "Record the booking owner's policy acceptance before payment - PAY-02",
    description:
      'Payment is blocked until this is called. Stores the acceptance with a timestamp; ' +
      'calling it again for the same booking is idempotent.',
  })
  @ApiCreatedResponse({ type: PolicyAcceptanceResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: ':type must be FLIGHT or HOTEL',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description:
      'The booking is unknown, belongs to another traveler, or that booking type has no provider yet',
  })
  acceptPolicies(
    @CurrentUser() user: AuthenticatedUser,
    @Param('type') type: string,
    @Param('id') id: string,
  ) {
    return this.policies.acceptPolicies(user, type, id);
  }
}
