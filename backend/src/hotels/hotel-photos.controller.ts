import {
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
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
import { HotelPhotoDto } from './dto/create-hotel.dto';
import { HotelPhotosService } from './hotel-photos.service';

/** GEN-08: photos of a hotel. Hotel moderator only, and only on their own hotel (checked in the service). */
@ApiTags('hotels')
@ApiCookieAuth()
@ApiUnauthorizedResponse({
  type: ErrorResponseDto,
  description: 'Not logged in',
})
@ApiForbiddenResponse({
  type: ErrorResponseDto,
  description: "Not a hotel moderator, or not the moderator's own hotel",
})
@Controller('hotels/:id/photos')
export class HotelPhotosController {
  constructor(private readonly photos: HotelPhotosService) {}

  @Post()
  @Roles(Role.HOTEL_MODERATOR)
  @UseInterceptors(
    FileInterceptor('image', {
      limits: { fileSize: IMAGE_MAX_BYTES, files: 1 },
    }),
  )
  @ApiOperation({
    summary:
      'Attach one photo (JPG or PNG, at most 5 MB, at most 5 per hotel) to my hotel - GEN-08',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['image'],
      properties: { image: { type: 'string', format: 'binary' } },
    },
  })
  @ApiCreatedResponse({ type: HotelPhotoDto, description: 'The stored photo' })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description:
      'No file in the image field, not a JPG or PNG, a file that is not a real image, or an empty file',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: "The moderator's own hotel no longer exists",
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'The hotel already has 5 photos',
  })
  @ApiPayloadTooLargeResponse({
    type: ErrorResponseDto,
    description: 'The file is larger than 5 MB',
  })
  attach(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @UploadedFile() file: UploadFile,
  ): Promise<HotelPhotoDto> {
    return this.photos.attach(id, actor, file);
  }

  @Delete(':photoId')
  @Roles(Role.HOTEL_MODERATOR)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Remove one photo from my hotel; the stored file is deleted too - GEN-08',
  })
  @ApiNoContentResponse({ description: 'Removed' })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'No such hotel, or the photo is not on this hotel',
  })
  remove(
    @Param('id') id: string,
    @Param('photoId') photoId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<void> {
    return this.photos.remove(id, photoId, actor);
  }
}
