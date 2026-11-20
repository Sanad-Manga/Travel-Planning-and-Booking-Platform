import { Body, Controller, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthenticatedUser, CurrentUser, ErrorResponseDto } from '../common';
import { CreateReportDto } from './dto/create-report.dto';
import { ReportResponseDto } from './dto/report-response.dto';
import { ReportsService } from './reports.service';

@ApiTags('reports')
@ApiCookieAuth()
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Post()
  @ApiOperation({
    summary:
      'Report a post, comment, review or itinerary (once per item per user)',
    description:
      'Any logged-in user. The report starts as OPEN. Only items the reporter could see can be reported. COMMENT and REVIEW are accepted values but return 400 until those modules exist. The admin listing and actions are GEN-10.',
  })
  @ApiCreatedResponse({ type: ReportResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'Missing or invalid targetType / targetId / reason',
  })
  @ApiUnauthorizedResponse({
    type: ErrorResponseDto,
    description: 'Not logged in',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'The item does not exist, or is not visible to the reporter',
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'This user already reported this item',
  })
  create(
    @Body() dto: CreateReportDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ReportResponseDto> {
    return this.reports.create(user, dto);
  }
}
