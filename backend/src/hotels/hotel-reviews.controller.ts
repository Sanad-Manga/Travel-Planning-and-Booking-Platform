import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
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
import { ReplyToHotelReviewDto } from './dto/reply-to-hotel-review.dto';
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

  @Post(':id/reply')
  @Roles(Role.HOTEL_MODERATOR)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reply to a review of your hotel (HTL-26)',
    description:
      'Only the moderator of the reviewed hotel can reply. Sending a reply again replaces the previous one.',
  })
  @ApiOkResponse({ type: HotelReviewItemDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'Reply is empty or too long',
  })
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description: 'Only a hotel moderator can reply, and only to their own hotel\'s reviews',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'Review not found',
  })
  reply(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ReplyToHotelReviewDto,
  ): Promise<HotelReviewItemDto> {
    return this.reviews.reply(id, user, dto);
  }
}
