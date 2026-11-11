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
import { ActivitiesService } from './activities.service';
import { ActivityIdParamDto } from './dto/activity-id-param.dto';
import { ActivityDto } from './dto/activity.dto';
import { UpdateActivityDto } from './dto/update-activity.dto';

// Activities belong to the owner of the itinerary (ITN-10), so every route needs the USER role. Adding one is
// POST /api/itineraries/:id/days/:dayId/activities, in ItinerariesController. Ownership is checked in the service.
@ApiTags('activities')
@ApiCookieAuth()
@ApiUnauthorizedResponse({
  type: ErrorResponseDto,
  description: 'Not logged in',
})
@ApiForbiddenResponse({
  type: ErrorResponseDto,
  description: 'Caller is not a registered user (admin or moderator)',
})
@Roles(Role.USER)
@Controller('activities')
export class ActivitiesController {
  constructor(private readonly activities: ActivitiesService) {}

  @Patch(':id')
  @ApiOperation({
    summary:
      'Edit one of my activities: name, description, time and/or cost; null clears the time or the cost - ITN-10',
  })
  @ApiOkResponse({ type: ActivityDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description:
      'Invalid id, an empty name, a time that is not HH:mm, a negative or fractional cost, an unknown field, or an empty body',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'No such activity (or it belongs to someone else)',
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: ActivityIdParamDto,
    @Body() dto: UpdateActivityDto,
  ) {
    return this.activities.update(user, params.id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete one of my activities - ITN-10' })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'id is not a valid id',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'No such activity (or it belongs to someone else)',
  })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: ActivityIdParamDto,
  ) {
    return this.activities.remove(user, params.id);
  }
}
