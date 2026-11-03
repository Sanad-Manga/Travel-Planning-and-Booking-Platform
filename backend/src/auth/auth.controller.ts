import { Body, Controller, Get, HttpCode, Post, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Response } from 'express';
import { AuthenticatedUser, CurrentUser, ErrorResponseDto, Public } from '../common';
import { setAccessCookie } from './auth-cookies';
import { AuthService } from './auth.service';
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
  @ApiOperation({ summary: 'Log in with email and password. The access token is set as an httpOnly cookie, never in the body.' })
  @ApiOkResponse({ type: UserResponseDto, description: 'The logged-in user. The token is in the Set-Cookie header.' })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Malformed email or missing password' })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto, description: 'Invalid email or password' })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'Account suspended' })
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response): Promise<UserResponseDto> {
    const { user, accessToken } = await this.authService.login(dto);
    setAccessCookie(res, accessToken, this.config.get<boolean>('cookieSecure') ?? false);
    return user;
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
