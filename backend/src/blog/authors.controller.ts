import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ErrorResponseDto, PaginationDto, Public } from '../common';
import { AuthorsService } from './authors.service';
import { AuthorPageDto } from './dto/author-page.dto';

@ApiTags('authors')
@Controller('authors')
export class AuthorsController {
  constructor(private readonly authorsService: AuthorsService) {}

  @Get(':id')
  @Public()
  @ApiOperation({
    summary:
      "Public author page: name, join date, published posts and public itineraries (BLG-12, open to guests). page and limit apply to both lists.",
  })
  @ApiOkResponse({ type: AuthorPageDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Invalid page or limit' })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Unknown or malformed id, or the account is deactivated' })
  findOne(@Param('id') id: string, @Query() query: PaginationDto): Promise<AuthorPageDto> {
    return this.authorsService.findOne(id, query);
  }
}
