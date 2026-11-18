import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query, Res } from '@nestjs/common';
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
import { Response } from 'express';
import {
  ApiPaginatedResponse,
  AuthenticatedUser,
  CurrentUser,
  ErrorResponseDto,
  PaginatedResponse,
  PaginationDto,
} from '../common';
import { AddFavouriteDto } from './dto/add-favourite.dto';
import { FavouriteDto } from './dto/favourite-response.dto';
import { FavouritesService } from './favourites.service';

/** BON-02: any logged-in user's own favourites. Guests get 401 from the global JwtAuthGuard (no @Public here). */
@ApiTags('favourites')
@ApiCookieAuth()
@ApiUnauthorizedResponse({ type: ErrorResponseDto, description: 'Not logged in' })
@Controller('favourites')
export class FavouritesController {
  constructor(private readonly favourites: FavouritesService) {}

  @Post()
  @ApiOperation({ summary: 'Save a hotel or a public itinerary to my favourites; saving it again changes nothing - BON-02' })
  @ApiCreatedResponse({ type: FavouriteDto, description: 'Saved' })
  @ApiOkResponse({ type: FavouriteDto, description: 'Already in my favourites (not duplicated)' })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'type is not HOTEL or ITINERARY, itemId is not a valid id, or an unknown field' })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'No such active hotel, or the itinerary does not exist or is not public',
  })
  async add(
    @Body() dto: AddFavouriteDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<FavouriteDto> {
    const { favourite, created } = await this.favourites.add(dto, actor);
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return favourite;
  }

  @Get()
  @ApiOperation({ summary: 'List my favourites, newest first (page size 10 by default) - BON-02' })
  @ApiPaginatedResponse(FavouriteDto)
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Invalid page or limit' })
  list(@Query() query: PaginationDto, @CurrentUser() actor: AuthenticatedUser): Promise<PaginatedResponse<FavouriteDto>> {
    return this.favourites.list(query, actor);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove one of my favourites - BON-02' })
  @ApiNoContentResponse({ description: 'Removed' })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: "Unknown or malformed id, or someone else's favourite" })
  remove(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser): Promise<void> {
    return this.favourites.remove(id, actor);
  }
}
