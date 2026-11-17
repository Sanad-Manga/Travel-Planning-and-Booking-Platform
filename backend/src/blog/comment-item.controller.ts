import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthenticatedUser, CurrentUser, ErrorResponseDto } from '../common';
import { CommentsService } from './comments.service';
import { CommentResponseDto } from './dto/comment-response.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';

/** BLG-07: edit and delete one comment by its own id (create and list stay under /posts/:id/comments). */
@ApiTags('comments')
@ApiCookieAuth()
@Controller('comments')
export class CommentItemController {
  constructor(private readonly commentsService: CommentsService) {}

  @Patch(':id')
  @ApiOperation({
    summary: 'Edit my own comment (BLG-07)',
    description:
      'Same body rules as creating a comment: non-empty after trimming, at most 500 characters, unknown fields rejected. Only the author may edit; ownership is checked in the service. A comment that a moderator has hidden cannot be edited (409). Comments of a draft or hidden post answer 404, like creating and listing do.',
  })
  @ApiOkResponse({ type: CommentResponseDto, description: 'Comment updated' })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description:
      'Comment must be non-empty and at most 500 characters, or the body has unknown fields',
  })
  @ApiUnauthorizedResponse({
    type: ErrorResponseDto,
    description: 'Not logged in or account is inactive',
  })
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description:
      "Someone else's comment (comments are public content, so 403, not 404). Admins have no edit right here; moderation is GEN-10",
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description:
      'Unknown or malformed id, post is a draft, hidden or deleted, or a hidden comment the caller may not see',
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'The comment was hidden by a moderator and cannot be edited',
  })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCommentDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<CommentResponseDto> {
    return this.commentsService.update(id, dto, actor);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete my own comment (BLG-07)',
    description:
      "Hard delete (like deleting a post). The post's commentCount goes down by one in the same transaction. The author may delete their comment even after a moderator hid it. Only the author may delete; ownership is checked in the service.",
  })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiUnauthorizedResponse({
    type: ErrorResponseDto,
    description: 'Not logged in or account is inactive',
  })
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description:
      "Someone else's comment (comments are public content, so 403, not 404). Admins delete through GEN-10, not here",
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description:
      'Unknown or malformed id, post is a draft, hidden or deleted, or a hidden comment the caller may not see',
  })
  remove(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<void> {
    return this.commentsService.remove(id, actor);
  }
}
