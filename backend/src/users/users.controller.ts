import { Body, Controller, Get, Patch } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { UserResponseDto } from '../auth/dto/user-response.dto';
import { AuthenticatedUser, CurrentUser, ErrorResponseDto } from '../common';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ProfileService } from './profile.service';

// Authenticated by the global JwtAuthGuard, any role. The user always comes from the token, so only your own profile is reachable.
@ApiTags('users')
@ApiCookieAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly profileService: ProfileService) {}

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
}
