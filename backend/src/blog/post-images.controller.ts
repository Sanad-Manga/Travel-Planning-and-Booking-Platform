import {
  Controller,
  Delete,
  HttpCode,
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
  ApiInternalServerErrorResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiParam,
  ApiPayloadTooLargeResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  AuthenticatedUser,
  CurrentUser,
  ErrorResponseDto,
  IMAGE_MAX_BYTES,
  MAX_IMAGES_PER_ENTITY,
} from '../common';
import { UploadFile } from '../uploads';
import { PostImageDto } from './dto/create-post.dto';
import { PostImagesService } from './post-images.service';

@ApiTags('posts')
@ApiCookieAuth()
@ApiForbiddenResponse({ type: ErrorResponseDto, description: 'Forced password replacement is required by the existing global authentication guard.' })
@Controller('posts/:id/images')
@ApiParam({
  name: 'id',
  description:
    'Post ObjectId; only its author may modify images, including drafts/hidden posts.',
})
export class PostImagesController {
  constructor(private readonly images: PostImagesService) {}

  @Post()
  // Multer's default memory storage: no dest/storage option or module-wide disk configuration.
  @UseInterceptors(
    FileInterceptor('image', {
      limits: { fileSize: IMAGE_MAX_BYTES, files: 1, fields: 0, parts: 2 },
    }),
  )
  @ApiOperation({
    summary: 'Attach one JPEG/PNG to my post (BLG-10)',
    description: `Shared byte/content validation; at most ${IMAGE_MAX_BYTES} bytes per image and ${MAX_IMAGES_PER_ENTITY} images per post. Returned URLs are public even for draft/hidden posts.`,
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['image'],
      properties: {
        image: {
          type: 'string',
          format: 'binary',
          description: 'One JPEG or PNG file, max 5 MiB.',
        },
      },
    },
  })
  @ApiCreatedResponse({ type: PostImageDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description:
      'Missing/empty/corrupt image, unsupported MIME/content mismatch or extra fields/files.',
  })
  @ApiPayloadTooLargeResponse({
    type: ErrorResponseDto,
    description: 'File exceeds the multipart 5 MiB limit.',
  })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'Invalid/missing post or another author’s post.',
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'Five-image limit or concurrent attachment change.',
  })
  @ApiInternalServerErrorResponse({
    type: ErrorResponseDto,
    description:
      'Storage/database unavailable or uncertain attachment acknowledgement; cleanup/reconciliation may be required.',
  })
  attach(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @UploadedFile() file: UploadFile,
  ) {
    return this.images.attach(id, actor, file);
  }

  @Delete(':imageId')
  @HttpCode(204)
  @ApiParam({
    name: 'imageId',
    description:
      'Attached upload ObjectId; cannot delete another post/entity’s file.',
  })
  @ApiOperation({
    summary: 'Remove one image from my post (BLG-10)',
    description:
      'Storage cleanup precedes atomic reference removal. Retry failures; already-removed/malformed/unassociated image IDs return 404. Legacy foreign references are detached without deleting foreign storage.',
  })
  @ApiNoContentResponse({
    description: 'Storage cleanup and reference removal completed.',
  })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description:
      'Invalid/missing/other-author post or missing/malformed/unassociated image.',
  })
  @ApiInternalServerErrorResponse({
    type: ErrorResponseDto,
    description:
      'Storage/reference cleanup failed. Retry; a reference may temporarily point to a removed file.',
  })
  remove(
    @Param('id') id: string,
    @Param('imageId') imageId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<void> {
    return this.images.remove(id, imageId, actor);
  }
}
