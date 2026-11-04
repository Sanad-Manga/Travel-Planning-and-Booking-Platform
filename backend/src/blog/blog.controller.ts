import { Body, Controller, Post } from '@nestjs/common';
import { ApiBadRequestResponse, ApiCookieAuth, ApiCreatedResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AuthenticatedUser, CurrentUser, ErrorResponseDto } from '../common';
import { BlogService } from './blog.service';
import { CreatePostDto } from './dto/create-post.dto';
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
}
