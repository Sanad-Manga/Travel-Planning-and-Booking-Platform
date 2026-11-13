import {
  Body,
  Controller,
  Header,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
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
import { AdminPasswordResetService } from './admin-password-reset.service';
import {
  AdminPasswordResetBodyDto,
  AdminPasswordResetParamsDto,
} from './dto/admin-password-reset.dto';
import { AdminPasswordResetResponseDto } from './dto/admin-password-reset-response.dto';

@ApiTags('admin')
@ApiCookieAuth()
@Roles(Role.ADMIN)
@Controller('admin/users')
export class AdminPasswordResetController {
  constructor(private readonly resets: AdminPasswordResetService) {}

  @Post(':id/reset-password')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Header('Pragma', 'no-cache')
  @ApiOperation({
    summary: 'Reset an ACTIVE user/moderator password (ADMIN only)',
    description:
      'Invalidates all previous access/refresh tokens atomically. Discloses a generated temporary password once, valid for one successful login before its 24-hour expiration. Restricted login permits only me, change-password and logout; refresh is rejected. Forced replacement invalidates that session and requires fresh login. No email/notification delivery.',
  })
  @ApiOkResponse({
    type: AdminPasswordResetResponseDto,
    headers: {
      'Cache-Control': {
        description: 'Always no-store',
        schema: { type: 'string', example: 'no-store' },
      },
    },
  })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'Invalid account ID or unsupported body field.',
  })
  @ApiUnauthorizedResponse({
    type: ErrorResponseDto,
    description: 'Authentication missing, inactive or invalidated.',
  })
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description: 'ADMIN role required or password replacement required.',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'Target account does not exist.',
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description:
      'ADMIN/inactive target, or concurrent credential/account change.',
  })
  @ApiInternalServerErrorResponse({
    type: ErrorResponseDto,
    description:
      'Generation/persistence/audit failed. Credentials may already have changed; another administrator reset may be needed.',
  })
  reset(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: AdminPasswordResetParamsDto,
    @Body() _body: AdminPasswordResetBodyDto,
  ): Promise<AdminPasswordResetResponseDto> {
    // The empty DTO exists to reject unsupported fields through the global pipe.
    void _body;
    return this.resets.reset(actor, params.id);
  }
}
