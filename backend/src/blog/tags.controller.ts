import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiPaginatedResponse, ErrorResponseDto, PaginatedResponse, PaginationDto, Public } from '../common';
import { BlogService } from './blog.service';
import { PostListRowDto } from './dto/post-list-row.dto';
import { TagParamDto } from './dto/tag-param.dto';

@ApiTags('tags')
@Controller('tags')
export class TagsController {
  constructor(private readonly blogService: BlogService) {}

  @Get(':tag/posts')
  @Public()
  @ApiOperation({ summary: 'List published posts that have this tag, newest first (BLG-08, public). Same rows as GET /api/posts.' })
  @ApiPaginatedResponse(PostListRowDto)
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Tag longer than 30 characters, invalid page or limit' })
  listPosts(@Param() params: TagParamDto, @Query() query: PaginationDto): Promise<PaginatedResponse<PostListRowDto>> {
    return this.blogService.listByTag(params.tag, query);
  }
}
