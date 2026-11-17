import { Controller, Param, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiOperation } from '@nestjs/swagger';
import { AuthenticatedUser, CurrentUser } from '../common';
import { ItineraryIdParamDto } from './dto/itinerary-id-param.dto';
import { ItineraryResponseDto } from './dto/itinerary-response.dto';
import { ApiBadRequest, ApiNotFound, UserRoutes } from './itineraries.swagger';
import { ItineraryCloneService } from './itinerary-clone.service';

// ITN-21: copying a public itinerary is for registered users, so it needs the USER role (a guest may only view).
@UserRoutes('itineraries')
@Controller('itineraries')
export class ItineraryCloneController {
  constructor(private readonly cloning: ItineraryCloneService) {}

  @Post(':id/clone')
  @ApiOperation({
    summary:
      'Clone a public itinerary into a new private one of mine: all days, activities, transport costs and budget entries, credited to the original author and independent of the original - ITN-21',
  })
  @ApiCreatedResponse({ type: ItineraryResponseDto })
  @ApiBadRequest('id is not a valid id')
  @ApiNotFound(
    'No such itinerary, or it is private, hidden by an admin, or its author is not active',
  )
  clone(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: ItineraryIdParamDto,
  ) {
    return this.cloning.clone(user, params.id);
  }
}
