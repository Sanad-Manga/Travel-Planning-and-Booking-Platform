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
import { ListProvidersQueryDto } from './dto/list-providers-query.dto';
import { ProviderListItemDto } from './dto/provider-list-item.dto';
import { ProviderListService } from './provider-list.service';

@ApiTags('admin')
@ApiCookieAuth()
@Roles(Role.ADMIN)
@Controller('admin/providers')
export class ProviderListController {
  constructor(private readonly providers: ProviderListService) {}

  @Get()
  @ApiOperation({
    summary: 'List providers by type (ADMIN only)',
    description:
      'Returns active and inactive providers of the selected type in ascending ID order.',
  })
  @ApiPaginatedResponse(ProviderListItemDto)
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description:
      'Missing or invalid type, invalid pagination, or unsupported query parameter.',
  })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description: 'Caller is not an ADMIN.',
  })
  @ApiInternalServerErrorResponse({
    type: ErrorResponseDto,
    description: 'Providers could not be retrieved.',
  })
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListProvidersQueryDto,
  ) {
    return this.providers.list(actor, query);
  }
}
