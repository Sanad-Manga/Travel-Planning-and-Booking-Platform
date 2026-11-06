import { Body, Controller, Get, HttpCode, Patch, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Request, Response } from 'express';
import { AuthenticatedUser, CurrentUser, ErrorResponseDto, Public, REFRESH_TOKEN_COOKIE } from '../common';
import { clearAuthCookies, setAuthCookies } from './auth-cookies';
import { AuthService } from './auth.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { UserResponseDto } from './dto/user-response.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Register a new user account (role USER). Does not log the user in.' })
  @ApiCreatedResponse({ type: UserResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Invalid email, weak password, missing consent or unknown field' })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'Email already registered' })
  register(@Body() dto: RegisterDto): Promise<UserResponseDto> {
    return this.authService.register(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Log in with email and password. Sets the access_token and refresh_token httpOnly cookies; no token is ever in the body.',
  })
  @ApiOkResponse({ type: UserResponseDto, description: 'The logged-in user. The tokens are only in the Set-Cookie headers.' })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Malformed email or missing password' })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto, description: 'Invalid email or password' })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'Account suspended' })
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response): Promise<UserResponseDto> {
    const { user, accessToken, refreshToken } = await this.authService.login(dto);
    setAuthCookies(res, { accessToken, refreshToken }, this.config.get<boolean>('cookieSecure') ?? false);
    return user;
  }

  // @Public: the access cookie may already have expired, which is exactly when the refresh cookie is needed.
  // The refresh token itself is verified in the service.
  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Renew the session using the refresh_token cookie. Sets a new access_token and refresh_token (a sliding 30 minutes).',
  })
  @ApiOkResponse({ type: UserResponseDto, description: 'The current user. The new tokens are only in the Set-Cookie headers.' })
  @ApiUnauthorizedResponse({
    type: ErrorResponseDto,
    description: 'Missing, invalid or expired refresh cookie, or the account is no longer active. Both cookies are cleared.',
  })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<UserResponseDto> {
    const secure = this.config.get<boolean>('cookieSecure') ?? false;
    try {
      const { user, accessToken, refreshToken } = await this.authService.refresh(req.cookies?.[REFRESH_TOKEN_COOKIE]);
      setAuthCookies(res, { accessToken, refreshToken }, secure);
      return user;
    } catch (error) {
      // A dead session: remove both cookies (same path and flags as when set) so the browser stops sending them.
      if (error instanceof UnauthorizedException) clearAuthCookies(res, secure);
      throw error;
    }
  }

  // Authenticated by the global JwtAuthGuard (no @Public); the user comes from the token, never from the body.
  @Patch('change-password')
  @HttpCode(204)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Change the logged-in user\'s password (current password + new password). The new password is stored only as a salted bcrypt hash.' })
  @ApiNoContentResponse({ description: 'Password changed. The current session stays valid.' })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'Field-level errors: new password breaks the rules, or currentPassword is incorrect',
  })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto, description: 'Not logged in, token invalid or expired, or account no longer active' })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'The password was changed by another request at the same moment' })
  changePassword(@CurrentUser() current: AuthenticatedUser, @Body() dto: ChangePasswordDto): Promise<void> {
    return this.authService.changePassword(current.userId, dto);
  }

  @Get('me')
  @ApiCookieAuth()
  @ApiOperation({ summary: 'The currently logged-in user' })
  @ApiOkResponse({ type: UserResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto, description: 'Not logged in, token invalid or expired, or account no longer active' })
  me(@CurrentUser() current: AuthenticatedUser): Promise<UserResponseDto> {
    return this.authService.getCurrentUser(current.userId);
  }
}
