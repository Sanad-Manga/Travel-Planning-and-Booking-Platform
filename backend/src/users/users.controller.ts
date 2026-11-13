import { Body, Controller, Delete, Get, HttpCode, Optional, Patch, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Response } from 'express';
import { UserResponseDto } from '../auth/dto/user-response.dto';
import { clearAuthCookies } from '../auth/auth-cookies';
import { AuthenticatedUser, CurrentUser, ErrorResponseDto, Role, Roles } from '../common';
import { AccountDeactivationService } from './account-deactivation.service';
import { DeactivateAccountResponseDto } from './dto/deactivate-account-response.dto';
import { DeactivateAccountDto } from './dto/deactivate-account.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ProfileService } from './profile.service';

// Authenticated by the global JwtAuthGuard, any role. The user always comes from the token, so only your own profile is reachable.
@ApiTags('users')
@ApiCookieAuth()
@Controller('users')
export class UsersController {
  constructor(
    private readonly profileService: ProfileService,
    private readonly deactivation: AccountDeactivationService,
    // Optional so test apps that mount UsersModule without a ConfigModule still boot; the real AppModule has a global one,
    // so `cookieSecure` is always read there (missing config means the non-secure local default).
    @Optional() private readonly config?: ConfigService,
  ) {}

  @Get('me')
  @ApiOperation({ summary: "The logged-in user's profile" })
  @ApiOkResponse({ type: UserResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto, description: 'Not logged in, token invalid or expired, or account no longer active' })
  me(@CurrentUser() current: AuthenticatedUser): Promise<UserResponseDto> {
    return this.profileService.getProfile(current.userId);
  }

  @Patch('me')
  @ApiOperation({
    summary: 'Edit your profile: name, phone and preferred currency. All fields are optional, at least one is required; nothing is saved unless every sent field is valid.',
  })
  @ApiOkResponse({ type: UserResponseDto, description: 'The updated profile' })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description:
      'Field-level errors: invalid name or phone, currency not supported, empty body, or an unknown field (email, role, status, ... cannot be changed here)',
  })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto, description: 'Not logged in, token invalid or expired, or account no longer active' })
  update(@CurrentUser() current: AuthenticatedUser, @Body() dto: UpdateProfileDto): Promise<UserResponseDto> {
    return this.profileService.updateProfile(current.userId, dto);
  }

  // Only role USER (assumption for the lead): deactivating the only admin or a provider's moderator would lock out the platform.
  @Delete('me')
  @HttpCode(200)
  @Roles(Role.USER)
  @ApiOperation({
    summary:
      'Deactivate your own account (ACC-12). Needs { "confirm": true }. Blocked while you have an upcoming CONFIRMED flight or hotel booking. Clears the auth cookies; the account can no longer log in. Nothing is deleted.',
  })
  @ApiOkResponse({ type: DeactivateAccountResponseDto, description: 'Account deactivated; both auth cookies are cleared' })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Field-level errors: confirm missing, not exactly true, or an unknown field' })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto, description: 'Not logged in, token invalid or expired, or account no longer active' })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'Admins and moderators cannot deactivate themselves here' })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'You have an upcoming CONFIRMED booking; the account stays ACTIVE' })
  async deactivate(
    @CurrentUser() current: AuthenticatedUser,
    @Body() _dto: DeactivateAccountDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<DeactivateAccountResponseDto> {
    await this.deactivation.deactivate(current.userId);
    clearAuthCookies(res, this.config?.get<boolean>('cookieSecure') ?? false);
    return { message: 'Account deactivated' };
  }
}
