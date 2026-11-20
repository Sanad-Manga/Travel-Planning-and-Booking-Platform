import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiInternalServerErrorResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  AuthenticatedUser,
  CurrentUser,
  ErrorResponseDto,
  Role,
  Roles,
} from '../common';
import { AdminAnalyticsService } from './admin-analytics.service';
import { AdminAnalyticsQueryDto } from './dto/admin-analytics-query.dto';
import { AdminAnalyticsResponseDto } from './dto/admin-analytics-response.dto';

@ApiTags('admin')
@ApiCookieAuth()
@Roles(Role.ADMIN)
@Controller('admin/analytics')
export class AdminAnalyticsController {
  constructor(private readonly analytics: AdminAnalyticsService) {}

  @Get()
  @ApiOperation({
    summary: 'Summarize bookings and net revenue by provider (ADMIN only)',
    description:
      'Counts all statuses by createdAt using both inclusive UTC calendar dates. Revenue uses current CONFIRMED and COMPLETED bookings (a completed stay or flight stays revenue) and cancelled bookings are not counted and subtracts completed refunds in the same currency. Payment attempts, pending refunds and failed refunds do not affect these totals.',
  })
  @ApiOkResponse({ type: AdminAnalyticsResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'Invalid, missing, reversed or unsupported period query.',
  })
  @ApiUnauthorizedResponse({
    type: ErrorResponseDto,
    description: 'Missing, invalid, expired or inactive authentication.',
  })
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description: 'Administrator role required.',
  })
  @ApiInternalServerErrorResponse({
    type: ErrorResponseDto,
    description:
      'Analytics could not be retrieved or stored booking or refund data is inconsistent.',
  })
  summarize(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: AdminAnalyticsQueryDto,
  ) {
    return this.analytics.summarize(actor, query);
  }
}
