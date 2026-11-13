import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiInternalServerErrorResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  ApiPaginatedResponse,
  AuthenticatedUser,
  CurrentUser,
  ErrorResponseDto,
  Role,
  Roles,
} from '../common';
import { AdminService } from './admin.service';
import { AccountResponseDto } from './dto/account-response.dto';
import { ListAccountsQueryDto } from './dto/list-accounts-query.dto';

@ApiTags('admin')
@ApiCookieAuth()
@Roles(Role.ADMIN)
@Controller('admin/accounts')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get()
  @ApiOperation({
    summary: 'List accounts (ADMIN only)',
    description:
      'Search name OR email using a case-insensitive literal substring, combined with role/status filters. Stable ascending ID order; no account mutations.',
  })
  @ApiPaginatedResponse(AccountResponseDto)
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description:
      'Invalid pagination, search or filters; unsupported query parameter.',
  })
  @ApiUnauthorizedResponse({
    type: ErrorResponseDto,
    description: 'Missing, expired or inactive authentication.',
  })
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description: 'Authenticated caller is not an ADMIN.',
  })
  @ApiInternalServerErrorResponse({
    type: ErrorResponseDto,
    description: 'Account list could not be retrieved.',
  })
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListAccountsQueryDto,
  ) {
    return this.admin.listAccounts(actor, query);
  }
}
