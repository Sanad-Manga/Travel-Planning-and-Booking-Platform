import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  ApiPaginatedResponse,
  AuthenticatedRequest,
  AuthenticatedUser,
  CurrentUser,
  ErrorResponseDto,
  PaginatedResponse,
  PaginationDto,
  Public,
} from '../common';
import { BlogService } from './blog.service';
import { BrowsePostsQueryDto } from './dto/browse-posts-query.dto';
import { CreatePostDto } from './dto/create-post.dto';
import { MyPostRowDto } from './dto/my-post-row.dto';
import { PostDetailDto } from './dto/post-detail.dto';
import { PostListRowDto } from './dto/post-list-row.dto';
import { PostResponseDto } from './dto/post-response.dto';
import { UpdatePostDto } from './dto/update-post.dto';

@ApiTags('posts')
@ApiCookieAuth()
@Controller('posts')
export class BlogController {
  constructor(private readonly blogService: BlogService) {}

  @Post()
  @ApiOperation({
    summary:
      'Create a blog post as DRAFT (default, private) or PUBLISHED (any logged-in user)',
  })
  @ApiCreatedResponse({ type: PostResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description:
      'Missing title/body, invalid field, more than 5 tags or images',
  })
  @ApiUnauthorizedResponse({
    type: ErrorResponseDto,
    description: 'Not logged in',
  })
  create(
    @Body() dto: CreatePostDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PostResponseDto> {
    return this.blogService.create(dto, user);
  }

  // Declared before any future GET /posts/:id so that "mine" is not read as an id.
  @Get('mine')
  @ApiOperation({
    summary:
      'List my own posts, drafts included, newest first (page size 10 by default)',
  })
  @ApiPaginatedResponse(MyPostRowDto)
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'Invalid page or limit',
  })
  @ApiUnauthorizedResponse({
    type: ErrorResponseDto,
    description: 'Not logged in',
  })
  listMine(
    @Query() query: PaginationDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PaginatedResponse<MyPostRowDto>> {
    return this.blogService.listMine(query, user);
  }

  @Get()
  @Public()
  @ApiOperation({
    summary:
      'Browse published posts, newest first, optionally filtered by tag (BLG-02, public)',
  })
  @ApiPaginatedResponse(PostListRowDto)
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'Invalid page, limit or tag',
  })
  list(
    @Query() query: BrowsePostsQueryDto,
  ): Promise<PaginatedResponse<PostListRowDto>> {
    return this.blogService.listPublished(query);
  }

  @Get(':id')
  @Public()
  @ApiOperation({
    summary:
      'Open a post: title, author, date, body, tags, images, like count and comments (BLG-02, public)',
  })
  @ApiOkResponse({ type: PostDetailDto })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description:
      'Unknown or malformed id, a draft, or a hidden post the caller may not see',
  })
  findOne(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<PostDetailDto> {
    // request.user is only set when the global guard identified the caller; guests have none.
    return this.blogService.findOne(id, request.user);
  }

  @Patch(':id')
  @ApiOperation({
    summary:
      'Edit my own post (partial update of title, body, tags, images, status)',
  })
  @ApiOkResponse({ type: PostResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'Empty body, invalid field, more than 5 tags or images',
  })
  @ApiUnauthorizedResponse({
    type: ErrorResponseDto,
    description: 'Not logged in',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: "Unknown or malformed id, or someone else's post",
  })
  update(
    @Param('id') id: string,
    @Body() dto: UpdatePostDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PostResponseDto> {
    return this.blogService.update(id, dto, user);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete my own post together with its comments and likes',
  })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiUnauthorizedResponse({
    type: ErrorResponseDto,
    description: 'Not logged in',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: "Unknown or malformed id, or someone else's post",
  })
  remove(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    return this.blogService.remove(id, user);
  }
}
