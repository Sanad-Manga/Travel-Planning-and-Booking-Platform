import { Controller, Delete, HttpCode, Param } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiNotImplementedResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthenticatedUser, CurrentUser, ErrorResponseDto, Role, Roles } from '../common';
import { AdminContentService } from './admin-content.service';
import { ContentTargetParamsDto } from './dto/content-target-params.dto';

@ApiTags('admin')
@ApiCookieAuth()
@Roles(Role.ADMIN)
@Controller('admin/content')
@ApiUnauthorizedResponse({ type: ErrorResponseDto, description: 'Not logged in.' })
@ApiForbiddenResponse({ type: ErrorResponseDto, description: 'Caller is not an ADMIN.' })
export class AdminContentController {
  constructor(private readonly content: AdminContentService) {}

  @Delete(':type/:id')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Delete any post, comment or itinerary directly (ADMIN only)',
    description:
      'GEN-10: deletes the target outright, independent of any report. A post delete cascades its comments, ' +
      'likes and images (same as the author deleting their own post). REVIEW is not yet supported (no reviews ' +
      'module exists) and answers 501, never a fabricated 404. Every call is audit-logged.',
  })
  @ApiNoContentResponse({ description: 'Deleted.' })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'The target does not exist.' })
  @ApiNotImplementedResponse({ type: ErrorResponseDto, description: 'REVIEW moderation is not implemented yet.' })
  remove(@CurrentUser() actor: AuthenticatedUser, @Param() params: ContentTargetParamsDto): Promise<void> {
    return this.content.delete(actor, params.type, params.id);
  }
}
