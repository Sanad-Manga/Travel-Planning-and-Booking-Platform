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
import {
  ProviderStatusBodyDto,
  ProviderStatusParamsDto,
  ProviderStatusResponseDto,
} from './dto/provider-status.dto';
import { ProviderStatusService } from './provider-status.service';

@ApiTags('admin')
@ApiCookieAuth()
@Roles(Role.ADMIN)
@Controller('admin/providers')
@ApiBadRequestResponse({
  type: ErrorResponseDto,
  description:
    ':type is not hotel or airline, invalid ObjectId, or a non-empty request body.',
})
@ApiUnauthorizedResponse({ type: ErrorResponseDto })
@ApiForbiddenResponse({
  type: ErrorResponseDto,
  description: 'Caller is not an ADMIN.',
})
@ApiNotFoundResponse({
  type: ErrorResponseDto,
  description: 'Hotel or airline does not exist.',
})
@ApiConflictResponse({
  type: ErrorResponseDto,
  description:
    'Provider is already in the requested state (already deactivated / already active).',
})
@ApiInternalServerErrorResponse({
  type: ErrorResponseDto,
  description:
    'Persistence failure, or the audit write failed (the change is then reverted and the message says whether that worked).',
})
export class ProviderStatusController {
  constructor(private readonly providers: ProviderStatusService) {}

  @Patch(':type/:id/deactivate')
  @ApiBody({
    required: false,
    schema: { type: 'object', additionalProperties: false },
  })
  @ApiOperation({
    summary: 'Deactivate a hotel or airline (ADMIN only)',
    description:
      'Sets isActive=false in one atomic conditional update. The provider is hidden from search and cannot receive NEW bookings; existing CONFIRMED bookings are not touched. Independent of the moderator account status. Every moderator linked to the provider gets a PROVIDER_DEACTIVATED notification, and one audit entry is written.',
  })
  @ApiOkResponse({ type: ProviderStatusResponseDto })
  deactivate(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: ProviderStatusParamsDto,
    @Body() _body: ProviderStatusBodyDto,
  ) {
    void _body; // ValidationPipe validates the deliberately empty body DTO.
    return this.providers.deactivate(actor, params.type, params.id);
  }

  @Patch(':type/:id/reactivate')
  @ApiBody({
    required: false,
    schema: { type: 'object', additionalProperties: false },
  })
  @ApiOperation({
    summary: 'Reactivate a hotel or airline (ADMIN only)',
    description:
      'Sets isActive=true in one atomic conditional update and writes one audit entry. No notification is sent: no provider-reactivated notification type exists in the shared enum.',
  })
  @ApiOkResponse({ type: ProviderStatusResponseDto })
  reactivate(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: ProviderStatusParamsDto,
    @Body() _body: ProviderStatusBodyDto,
  ) {
    void _body;
    return this.providers.reactivate(actor, params.type, params.id);
  }
}
