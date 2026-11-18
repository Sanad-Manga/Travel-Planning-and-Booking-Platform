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
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  AuthenticatedUser,
  CurrentUser,
  ErrorResponseDto,
  Role,
  Roles,
} from '../common';
import { HotelReviewItemDto } from './dto/hotel-details-response.dto';
import { UpdateHotelReviewDto } from './dto/update-hotel-review.dto';
import { HotelReviewsService } from './hotel-reviews.service';

@ApiTags('hotel-reviews')
@ApiCookieAuth()
@ApiUnauthorizedResponse({
  type: ErrorResponseDto,
  description: 'Not logged in',
})
@Controller('reviews')
export class HotelReviewsController {
  constructor(private readonly reviews: HotelReviewsService) {}

  @Patch(':id')
  @Roles(Role.USER)
  @ApiOperation({
    summary: 'Edit your hotel review (HTL-23)',
    description:
      'Only the traveler who submitted the review can change its rating or written review.',
  })
  @ApiOkResponse({ type: HotelReviewItemDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'Rating or review text is invalid, or no fields were sent',
  })
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description: 'Only a traveler can edit a review',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'Review not found',
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateHotelReviewDto,
  ): Promise<HotelReviewItemDto> {
    return this.reviews.update(id, user, dto);
  }

  @Delete(':id')
  @Roles(Role.USER)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete your hotel review (HTL-23)',
    description: 'Only the traveler who submitted the review can delete it.',
  })
  @ApiNoContentResponse({ description: 'Review deleted' })
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description: 'Only a traveler can delete a review',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'Review not found',
  })
  async delete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<void> {
    await this.reviews.delete(id, user);
  }
}
