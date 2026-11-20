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
import { AirlineLogoService } from './airline-logo.service';
import { AirlineLogoDto } from './dto/airline-logo.dto';

/** GEN-08: the logo of an airline. Airline moderator only, and only for their own airline (checked in the service). */
@ApiTags('airlines')
@ApiCookieAuth()
@ApiUnauthorizedResponse({
  type: ErrorResponseDto,
  description: 'Not logged in',
})
@ApiForbiddenResponse({
  type: ErrorResponseDto,
  description: "Not an airline moderator, or not the moderator's own airline",
})
@Controller('airlines/:id/logo')
export class AirlineLogoController {
  constructor(private readonly logos: AirlineLogoService) {}

  @Post()
  @Roles(Role.AIRLINE_MODERATOR)
  @UseInterceptors(
    FileInterceptor('image', {
      limits: { fileSize: IMAGE_MAX_BYTES, files: 1 },
    }),
  )
  @ApiOperation({
    summary:
      'Upload the logo (JPG or PNG, at most 5 MB, one per airline) of my airline - GEN-08',
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
    type: AirlineLogoDto,
    description: 'The stored logo; the airline now shows it as logoUrl',
  })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description:
      'No file in the image field, not a JPG or PNG, a file that is not a real image, or an empty file',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: "The moderator's own airline no longer exists",
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'The airline already has a logo; remove it first',
  })
  @ApiPayloadTooLargeResponse({
    type: ErrorResponseDto,
    description: 'The file is larger than 5 MB',
  })
  attach(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @UploadedFile() file: UploadFile,
  ): Promise<AirlineLogoDto> {
    return this.logos.attach(id, actor, file);
  }

  @Delete()
  @Roles(Role.AIRLINE_MODERATOR)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Remove the logo of my airline; the stored file is deleted too - GEN-08',
  })
  @ApiNoContentResponse({ description: 'Removed' })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'The airline has no logo',
  })
  remove(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<void> {
    return this.logos.remove(id, actor);
  }
}
