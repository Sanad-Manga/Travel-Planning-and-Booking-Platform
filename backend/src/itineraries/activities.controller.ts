import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  AuthenticatedUser,
  CurrentUser,
  ErrorResponseDto,
  IMAGE_MAX_BYTES,
  Role,
  Roles,
} from '../common';
import { UploadFile } from '../uploads';
import { ActivitiesService } from './activities.service';
import { ActivityIdParamDto } from './dto/activity-id-param.dto';
import { ActivityImageParamDto } from './dto/activity-image-param.dto';
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

  @Post(':id/images')
  @UseInterceptors(
    FileInterceptor('image', {
      limits: { fileSize: IMAGE_MAX_BYTES, files: 1 },
    }),
  )
  @ApiOperation({
    summary:
      'Attach one image (JPG or PNG, at most 5 MB, at most 5 per activity) to one of my activities - ITN-12',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['image'],
      properties: { image: { type: 'string', format: 'binary' } },
    },
  })
  @ApiCreatedResponse({
    type: ActivityDto,
    description: 'The activity with its images, including the new one',
  })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description:
      'Invalid id, no file in the image field, not a JPG or PNG, a file that is not a real image, or an empty file',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'No such activity (or it belongs to someone else)',
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'The activity already has 5 images',
  })
  @ApiPayloadTooLargeResponse({
    type: ErrorResponseDto,
    description: 'The file is larger than 5 MB',
  })
  attachImage(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: ActivityIdParamDto,
    @UploadedFile() file: UploadFile,
  ) {
    return this.activities.attachImage(user, params.id, file);
  }

  @Delete(':id/images/:imageId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Remove one image of one of my activities (the file and the reference) - ITN-12',
  })
  @ApiNoContentResponse({ description: 'Removed' })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'id or imageId is not a valid id',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description:
      'No such activity, or the image is not one of its images (or the activity belongs to someone else)',
  })
  removeImage(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: ActivityImageParamDto,
  ) {
    return this.activities.removeImage(user, params.id, params.imageId);
  }
}
