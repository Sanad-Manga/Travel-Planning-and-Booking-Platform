import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  ApiPaginatedResponse,
  AuthenticatedUser,
  CurrentUser,
  ErrorResponseDto,
  PaginatedResponse,
  PaginationDto,
} from '../common';
import { CommentsService } from './comments.service';
import { CommentResponseDto } from './dto/comment-response.dto';
import { CreateCommentDto } from './dto/create-comment.dto';

@ApiTags('comments')
@ApiCookieAuth()
@Controller('posts/:id/comments')
export class CommentsController {
  constructor(private readonly commentsService: CommentsService) {}

  @Post()
  @ApiOperation({
    summary: 'Comment on a published, visible post (BLG-05)',
  })
  @ApiCreatedResponse({
    type: CommentResponseDto,
    description: 'Comment created',
  })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'Comment must be non-empty and at most 500 characters',
  })
  @ApiUnauthorizedResponse({
    type: ErrorResponseDto,
    description: 'Not logged in or account is inactive',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'Post does not exist, is a draft, or is hidden',
  })
  create(
    @Param('id') postId: string,
    @Body() dto: CreateCommentDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<CommentResponseDto> {
    return this.commentsService.create(postId, dto, actor);
  }

  @Get()
  @ApiOperation({
    summary: 'List comments oldest first (BLG-05)',
    description:
      'Requires login. Hidden comments are visible only to their author and admins. Uses page and limit pagination.',
  })
  @ApiPaginatedResponse(CommentResponseDto)
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'Invalid page or limit',
  })
  @ApiUnauthorizedResponse({
    type: ErrorResponseDto,
    description: 'Not logged in or account is inactive',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description:
      'Post does not exist, is a draft, or is hidden from the caller',
  })
  list(
    @Param('id') postId: string,
    @Query() query: PaginationDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<PaginatedResponse<CommentResponseDto>> {
    return this.commentsService.list(postId, query, actor);
  }
}