import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiCookieAuth, ApiCreatedResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { ApiPaginatedResponse, AuthenticatedUser, CurrentUser, ErrorResponseDto, PaginatedResponse, PaginationDto } from '../common';
import { BlogService } from './blog.service';
import { CreatePostDto } from './dto/create-post.dto';
import { MyPostRowDto } from './dto/my-post-row.dto';
import { PostResponseDto } from './dto/post-response.dto';

@ApiTags('posts')
@ApiCookieAuth()
@Controller('posts')
export class BlogController {
  constructor(private readonly blogService: BlogService) {}

  @Post()
  @ApiOperation({ summary: 'Create a blog post as DRAFT (default, private) or PUBLISHED (any logged-in user)' })
  @ApiCreatedResponse({ type: PostResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Missing title/body, invalid field, more than 5 tags or images' })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto, description: 'Not logged in' })
  create(@Body() dto: CreatePostDto, @CurrentUser() user: AuthenticatedUser): Promise<PostResponseDto> {
    return this.blogService.create(dto, user);
  }

  // Declared before any future GET /posts/:id so that "mine" is not read as an id.
  @Get('mine')
  @ApiOperation({ summary: 'List my own posts, drafts included, newest first (page size 10 by default)' })
  @ApiPaginatedResponse(MyPostRowDto)
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Invalid page or limit' })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto, description: 'Not logged in' })
  listMine(@Query() query: PaginationDto, @CurrentUser() user: AuthenticatedUser): Promise<PaginatedResponse<MyPostRowDto>> {
    return this.blogService.listMine(query, user);
  }
}
