import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiNotImplementedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ApiPaginatedResponse, AuthenticatedUser, CurrentUser, ErrorResponseDto, PaginationDto, Role, Roles } from '../common';
import { ReportIdParamsDto } from './dto/report-id-params.dto';
import { ReportRowDto } from './dto/report-row.dto';
import { ResolveReportDto } from './dto/resolve-report.dto';
import { ReportsAdminService } from './reports-admin.service';

@ApiTags('admin')
@ApiCookieAuth()
@Roles(Role.ADMIN)
@Controller('admin/reports')
@ApiUnauthorizedResponse({ type: ErrorResponseDto, description: 'Not logged in.' })
@ApiForbiddenResponse({ type: ErrorResponseDto, description: 'Caller is not an ADMIN.' })
export class ReportsAdminController {
  constructor(private readonly reportsAdmin: ReportsAdminService) {}

  @Get()
  @ApiOperation({ summary: 'List open reports, newest first (ADMIN only)' })
  @ApiPaginatedResponse(ReportRowDto)
  list(@CurrentUser() actor: AuthenticatedUser, @Query() query: PaginationDto) {
    return this.reportsAdmin.list(actor, query);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Resolve a report: dismiss it, hide the content, or delete it (ADMIN only)',
    description:
      'GEN-10: atomic on the report itself (resolving an already-resolved report is rejected with 409). ' +
      'HIDE/DELETE also apply to the reported content; REVIEW is not yet supported (no reviews module exists) ' +
      'and answers 501. Every resolution is audit-logged.',
  })
  @ApiOkResponse({ type: ReportRowDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Invalid resolution value.' })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Report not found.' })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'Report is already resolved.' })
  @ApiNotImplementedResponse({ type: ErrorResponseDto, description: 'REVIEW moderation is not implemented yet.' })
  resolve(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: ReportIdParamsDto,
    @Body() dto: ResolveReportDto,
  ) {
    return this.reportsAdmin.resolve(actor, params.id, dto);
  }
}
