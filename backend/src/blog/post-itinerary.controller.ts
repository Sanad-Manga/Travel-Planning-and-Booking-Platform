import { Body, Controller, Param, Patch } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthenticatedUser, CurrentUser, ErrorResponseDto } from '../common';
import { AttachItineraryDto } from './dto/attach-itinerary.dto';
import { PostResponseDto } from './dto/post-response.dto';
import { PostItineraryService } from './post-itinerary.service';

/** BLG-13: attach an itinerary to a post. Any logged-in user, but only their own post and itinerary (checked in the service). */
@ApiTags('posts')
@ApiCookieAuth()
@Controller('posts/:id/itinerary')
export class PostItineraryController {
  constructor(private readonly postItinerary: PostItineraryService) {}

  @Patch()
  @ApiOperation({
    summary:
      'Attach one of my itineraries to my post, or remove it with null (BLG-13). Readers see it only while the itinerary is public.',
  })
  @ApiOkResponse({ type: PostResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'itineraryId missing, not a valid id and not null, or an unknown field' })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto, description: 'Not logged in' })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: "Unknown or malformed post id, someone else's post, or an itinerary that does not exist or is not mine",
  })
  attach(
    @Param('id') id: string,
    @Body() dto: AttachItineraryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<PostResponseDto> {
    return this.postItinerary.attach(id, dto.itineraryId, actor);
  }
}
