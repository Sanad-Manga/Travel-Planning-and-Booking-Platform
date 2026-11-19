import { Body, Controller, Get, HttpCode, Patch, Post, Query, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
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
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Request, Response } from 'express';
import { AllowWhenMustChange, AuthenticatedUser, CurrentUser, ErrorResponseDto, Public, REFRESH_TOKEN_COOKIE } from '../common';
import { clearAuthCookies, setAuthCookies } from './auth-cookies';
import { AuthRateLimitGuard, AuthRateLimited } from './auth-rate-limit';
import { AuthService } from './auth.service';
import { EmailVerificationService, ResendCooldownException } from './email-verification.service';
import { VerifyEmailQueryDto } from './dto/verify-email-query.dto';
import { VerifyEmailResponseDto } from './dto/verify-email-response.dto';
import { FORGOT_PASSWORD_RESPONSE_MESSAGE } from './auth.constants';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto, ForgotPasswordResponseDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { PasswordResetService } from './password-reset.service';
import { LoginDto } from './dto/login.dto';
import { LogoutResponseDto } from './dto/logout-response.dto';
import { RegisterDto } from './dto/register.dto';
import { UserResponseDto } from './dto/user-response.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly emailVerification: EmailVerificationService,
    private readonly config: ConfigService,
    private readonly passwordReset: PasswordResetService,
  ) {}

  // ACC-07. Always the same 200, whatever the email: the work happens after the response is decided (see the service).
  @Public()
  @UseGuards(AuthRateLimitGuard)
  @AuthRateLimited('forgot-password')
  @Post('forgot-password')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Request a password-reset link by email. The answer is identical for every well-formed email.',
    description:
      'If the email belongs to an ACTIVE account, a single-use link valid for 30 minutes is emailed; a newer request invalidates older links. Unknown, suspended and deactivated accounts get no email and the same response. The email is sent after the response, and a failed send never changes it.',
  })
  @ApiOkResponse({ type: ForgotPasswordResponseDto, description: 'Always this body for a well-formed email.' })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Malformed or missing email, or unknown field' })
  @ApiResponse({ status: 429, type: ErrorResponseDto, description: 'More than 10 requests from this IP in 15 minutes. Retry-After header gives the seconds to wait. Never depends on the email.' })
  forgotPassword(@Body() dto: ForgotPasswordDto): ForgotPasswordResponseDto {
    this.passwordReset.requestReset(dto.email);
    return { message: FORGOT_PASSWORD_RESPONSE_MESSAGE };
  }

  // ACC-07. Does not log the user in: they sign in with the new password.
  @Public()
  @UseGuards(AuthRateLimitGuard)
  @AuthRateLimited('reset-password')
  @Post('reset-password')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Set a new password with the token from the reset email. The token works once.',
    description:
      'All existing sessions and refresh tokens are invalidated, the login lockout is cleared, and no cookie is set: log in with the new password.',
  })
  @ApiNoContentResponse({ description: 'Password replaced.' })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description:
      'Field-level errors: newPassword breaks the rules (token not consumed), or token is invalid, expired, already used or replaced (one message for all of them).',
  })
  @ApiResponse({ status: 429, type: ErrorResponseDto, description: 'More than 10 requests from this IP in 15 minutes. Retry-After header gives the seconds to wait.' })
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<void> {
    await this.passwordReset.reset(dto);
  }

  @Public()
  @Post('register')
  @ApiOperation({
    summary: 'Register a new user account (role USER). Does not log the user in.',
    description: 'Also emails a verification link (ACC-02, sent in the background; a send failure never fails registration). The account starts with emailVerified=false; GET /api/auth/verify-email verifies it.',
  })
  @ApiCreatedResponse({ type: UserResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Invalid email, weak password, missing consent or unknown field' })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'Email already registered' })
  register(@Body() dto: RegisterDto): Promise<UserResponseDto> {
    return this.authService.register(dto);
  }

  // @Public: the user clicks the link from an email and has no session. The token itself is the credential.
  @Public()
  @Get('verify-email')
  @ApiOperation({
    summary: 'Verify the email address with the token from the registration email (ACC-02).',
    description: 'The token is single use and valid for 24 hours. Until the email is verified, booking-creation routes protected with @RequireVerifiedEmail() answer 403.',
  })
  @ApiOkResponse({ type: VerifyEmailResponseDto, description: 'Email verified (or already verified).' })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'Field-level error on `token`: missing, or "invalid or expired verification link" (unknown, expired, already used, or the account is not ACTIVE).',
  })
  verifyEmail(@Query() query: VerifyEmailQueryDto): Promise<VerifyEmailResponseDto> {
    return this.emailVerification.verify(query.token);
  }

  // Authenticated by the global JwtAuthGuard (an unverified user can log in); the user comes from the token, there is no body.
  @Post('resend-verification')
  @HttpCode(200)
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Send a new email-verification link to the logged-in user (ACC-02).',
    description:
      'A new link replaces the old one (the old link stops working). Already verified accounts get 200 and no email. At most one link per 60 seconds: inside the cooldown the answer is 429 with a Retry-After header (seconds). The email is sent after the response and a failed send never changes it.',
  })
  @ApiOkResponse({ type: VerifyEmailResponseDto, description: 'Link sent, or the account is already verified (nothing sent).' })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto, description: 'Not logged in, token invalid or expired, or account no longer active' })
  @ApiResponse({ status: 429, type: ErrorResponseDto, description: 'A link was issued less than 60 seconds ago. Retry-After gives the seconds to wait.' })
  async resendVerification(@CurrentUser() current: AuthenticatedUser, @Res({ passthrough: true }) res: Response): Promise<VerifyEmailResponseDto> {
    try {
      return await this.emailVerification.resend(current.userId);
    } catch (error) {
      if (error instanceof ResendCooldownException) res.setHeader('Retry-After', String(error.retryAfterSeconds));
      throw error;
    }
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Log in with email and password. Sets the access_token and refresh_token httpOnly cookies; no token is ever in the body.',
    description: 'Temporary administrator-issued passwords expire after 24 hours and permit one successful login. mustChangePassword=true limits the session to me, change-password and logout; no refresh. Complete password replacement, then log in again.',
  })
  @ApiOkResponse({ type: UserResponseDto, description: 'The logged-in user. The tokens are only in the Set-Cookie headers.' })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Malformed email or missing password' })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto, description: 'Invalid email or password' })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'Account suspended' })
  @ApiResponse({
    status: 423,
    type: ErrorResponseDto,
    description: 'Account locked for 15 minutes after 5 consecutive failed logins (the 5th failure already returns 423). The correct password is also rejected while locked.',
  })
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
    description:
      'Refresh tokens rotate and are single use: the cookie sent here is consumed, and replaying it (or sending it twice at the same moment) returns 401. Only the newest refresh cookie works. Logout invalidates the current refresh token. Access tokens are stateless and stay valid until they expire (up to 15 minutes), also after logout.',
  })
  @ApiOkResponse({ type: UserResponseDto, description: 'The current user. The new tokens are only in the Set-Cookie headers.' })
  @ApiUnauthorizedResponse({
    type: ErrorResponseDto,
    description:
      'Missing, invalid, expired, revoked, already used (replayed) or outdated-version refresh cookie, inactive account, or forced password replacement pending. Same generic message for all; both cookies are cleared.',
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
  @AllowWhenMustChange()
  @HttpCode(204)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Change the logged-in user\'s password (current password + new password). The new password is stored only as a salted bcrypt hash.' })
  @ApiNoContentResponse({ description: 'Ordinary change: current session stays valid. Forced replacement: temporary state cleared, all tokens invalidated, cookies cleared; log in again with the new password.' })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'Field-level errors: new password breaks the rules, or currentPassword is incorrect',
  })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto, description: 'Not logged in, token invalid or expired, or account no longer active' })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'The password was changed by another request at the same moment' })
  async changePassword(@CurrentUser() current: AuthenticatedUser, @Body() dto: ChangePasswordDto, @Res({ passthrough: true }) res: Response): Promise<void> {
    const forced = await this.authService.changePassword(current.userId, dto, current.tokenVersion ?? 0);
    if (forced) clearAuthCookies(res, this.config.get<boolean>('cookieSecure') ?? false);
  }

  // @Public: logout must work even when the access cookie has already expired or there is no session at all.
  // The refresh cookie is sent because it is scoped to /api/auth.
  @Public()
  @Post('logout')
  @AllowWhenMustChange()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Log out. Clears both auth cookies and revokes the refresh token on the server. Always 200, even without a session.',
  })
  @ApiOkResponse({ type: LogoutResponseDto, description: 'Cookies cleared. The refresh token (if any) can no longer be used.' })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<LogoutResponseDto> {
    // Cookies first (same path and flags as when set), so the browser is logged out even if revocation fails.
    clearAuthCookies(res, this.config.get<boolean>('cookieSecure') ?? false);
    await this.authService.logout(req.cookies?.[REFRESH_TOKEN_COOKIE]);
    return { message: 'Logged out' };
  }

  @Get('me')
  @AllowWhenMustChange()
  @ApiCookieAuth()
  @ApiOperation({ summary: 'The currently logged-in user' })
  @ApiOkResponse({ type: UserResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto, description: 'Not logged in, token invalid or expired, or account no longer active' })
  me(@CurrentUser() current: AuthenticatedUser): Promise<UserResponseDto> {
    return this.authService.getCurrentUser(current.userId);
  }
}
