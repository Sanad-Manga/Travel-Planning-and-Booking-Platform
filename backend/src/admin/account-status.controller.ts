import { Body, Controller, Param, Patch } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
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
import { AccountStatusService } from './account-status.service';
import {
  AccountStatusBodyDto,
  AccountStatusParamsDto,
  AccountStatusResponseDto,
} from './dto/account-status.dto';

@ApiTags('admin')
@ApiCookieAuth()
@Roles(Role.ADMIN)
@Controller('admin/accounts')
@ApiBadRequestResponse({
  type: ErrorResponseDto,
  description: 'Invalid ObjectId or nonempty request body.',
})
@ApiUnauthorizedResponse({ type: ErrorResponseDto })
@ApiForbiddenResponse({
  type: ErrorResponseDto,
  description: 'Caller is not an ADMIN.',
})
@ApiNotFoundResponse({
  type: ErrorResponseDto,
  description: 'Account does not exist.',
})
@ApiConflictResponse({
  type: ErrorResponseDto,
  description:
    'DEACTIVATED or non-USER target, or administrator targeting themselves. Repeated target status succeeds as a no-op.',
})
@ApiInternalServerErrorResponse({
  type: ErrorResponseDto,
  description:
    'Persistence failure. If audit/notification delivery fails after the update, status may already have changed; do not blindly retry.',
})
export class AccountStatusController {
  constructor(private readonly status: AccountStatusService) {}

  @Patch(':id/suspend')
  @ApiBody({
    required: false,
    schema: { type: 'object', additionalProperties: false },
  })
  @ApiOperation({
    summary: 'Suspend an ACTIVE registered USER (ADMIN only)',
    description:
      'ADMIN-only, registered USER targets. Atomic ACTIVE to SUSPENDED; already SUSPENDED succeeds as a no-op. Preserves bookings/content. Status update precedes awaited audit, then best-effort ACCOUNT_SUSPENDED notification. Audit failure returns 500 after status may have changed; a retry recovers recorded pending work using its original actor. Completed repeats do not replay side effects. Status and audit are not transactionally atomic; crash/uncertain-ack recovery is not exactly-once.',
  })
  @ApiOkResponse({ type: AccountStatusResponseDto })
  suspend(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: AccountStatusParamsDto,
    @Body() _body: AccountStatusBodyDto,
  ) {
    void _body; // ValidationPipe validates the deliberately empty body DTO.
    return this.status.suspend(actor, params.id);
  }

  @Patch(':id/reactivate')
  @ApiBody({
    required: false,
    schema: { type: 'object', additionalProperties: false },
  })
  @ApiOperation({
    summary: 'Reactivate a SUSPENDED registered USER (ADMIN only)',
    description:
      'ADMIN-only, registered USER targets. Atomic SUSPENDED to ACTIVE; already ACTIVE succeeds as a no-op. Rejects DEACTIVATED, ADMIN/moderator and self targets. Awaited audit precedes best-effort ACCOUNT_REACTIVATED notification. Audit failure returns 500 after status may have changed. Retries recover recorded operations without attributing historical actions to the retrying caller; incomplete historical/crash-window auditing cannot be reconstructed or guaranteed exactly-once.',
  })
  @ApiOkResponse({ type: AccountStatusResponseDto })
  reactivate(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: AccountStatusParamsDto,
    @Body() _body: AccountStatusBodyDto,
  ) {
    void _body;
    return this.status.reactivate(actor, params.id);
  }
}
