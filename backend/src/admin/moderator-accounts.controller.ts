import { Body, Controller, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthenticatedUser, CurrentUser, ErrorResponseDto, Role, Roles } from '../common';
import { AccountResponseDto } from './dto/account-response.dto';
import { CreateModeratorDto } from './dto/create-moderator.dto';
import { ModeratorAccountsService } from './moderator-accounts.service';

@ApiTags('admin')
@ApiCookieAuth()
@Roles(Role.ADMIN)
@Controller('admin/moderators')
export class ModeratorAccountsController {
  constructor(private readonly moderators: ModeratorAccountsService) {}

  @Post()
  @ApiOperation({
    summary: 'Create an airline or hotel moderator (ADMIN only)',
    description:
      'Creates an ACTIVE moderator linked to exactly ONE existing airline (AIRLINE_MODERATOR) or hotel (HOTEL_MODERATOR). ' +
      'The admin sets a temporary password: it works for one login within 24 hours, then the session is limited to GET /api/auth/me, ' +
      'PATCH /api/auth/change-password and logout until the moderator replaces it (a fresh login follows). The password is never returned.',
  })
  @ApiBody({
    type: CreateModeratorDto,
    examples: {
      hotelModerator: {
        summary: 'Hotel moderator',
        value: {
          name: 'Hala Hotel',
          email: 'hala.hotel@example.com',
          role: 'HOTEL_MODERATOR',
          temporaryPassword: 'Temp0rary9Pass',
          hotelId: '6730a1f2c3d4e5f607182932',
        },
      },
      airlineModerator: {
        summary: 'Airline moderator',
        value: {
          name: 'Omar Airline',
          email: 'omar.airline@example.com',
          role: 'AIRLINE_MODERATOR',
          temporaryPassword: 'Temp0rary9Pass',
          airlineId: '6730a1f2c3d4e5f607182931',
        },
      },
    },
  })
  @ApiCreatedResponse({ type: AccountResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description:
      'Invalid body, role other than AIRLINE_MODERATOR/HOTEL_MODERATOR, weak password, or the provider id does not match the role (both, neither or the wrong one). One `details` entry per field.',
  })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto, description: 'Not logged in.' })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'Caller is not an ADMIN.' })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'The airline or hotel does not exist.' })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'Email already registered.' })
  @ApiInternalServerErrorResponse({ type: ErrorResponseDto, description: 'Creation or audit failed.' })
  create(@CurrentUser() actor: AuthenticatedUser, @Body() dto: CreateModeratorDto): Promise<AccountResponseDto> {
    return this.moderators.create(actor, dto);
  }
}
