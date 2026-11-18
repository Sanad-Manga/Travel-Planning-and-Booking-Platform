import { Controller, Delete, HttpCode, HttpStatus, Param, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthenticatedUser, CurrentUser, ErrorResponseDto, IMAGE_MAX_BYTES } from '../common';
import { UploadFile } from '../uploads';
import { PostImageDto } from './dto/post-image.dto';
import { PostImagesService } from './post-images.service';

/** BLG-10: images of a post. Any logged-in user, but only on their own post (checked in the service). */
@ApiTags('posts')
@ApiCookieAuth()
@ApiUnauthorizedResponse({ type: ErrorResponseDto, description: 'Not logged in' })
@Controller('posts/:id/images')
export class PostImagesController {
  constructor(private readonly images: PostImagesService) {}

  @Post()
  @UseInterceptors(FileInterceptor('image', { limits: { fileSize: IMAGE_MAX_BYTES, files: 1 } }))
  @ApiOperation({ summary: 'Attach one image (JPG or PNG, at most 5 MB, at most 5 per post) to my post - BLG-10' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['image'],
      properties: { image: { type: 'string', format: 'binary' } },
    },
  })
  @ApiCreatedResponse({ type: PostImageDto, description: 'The stored image' })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'No file in the image field, not a JPG or PNG, a file that is not a real image, or an empty file',
  })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'No such post (or it belongs to someone else)' })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'The post already has 5 images' })
  @ApiPayloadTooLargeResponse({ type: ErrorResponseDto, description: 'The file is larger than 5 MB' })
  attach(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @UploadedFile() file: UploadFile,
  ): Promise<PostImageDto> {
    return this.images.attach(id, actor, file);
  }

  @Delete(':imageId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove one image from my post; the stored file is deleted too - BLG-10' })
  @ApiNoContentResponse({ description: 'Removed' })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'No such post (or it belongs to someone else), or the image is not on this post',
  })
  remove(
    @Param('id') id: string,
    @Param('imageId') imageId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<void> {
    return this.images.remove(id, imageId, actor);
  }
}
