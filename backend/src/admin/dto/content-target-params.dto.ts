import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsMongoId } from 'class-validator';
import { ContentType } from '../../common';

export class ContentTargetParamsDto {
  @ApiProperty({ enum: ContentType, example: ContentType.POST })
  @IsEnum(ContentType, {
    message: `type must be one of: ${Object.values(ContentType).join(', ')}`,
  })
  type: ContentType;

  @ApiProperty({ description: 'The target\'s own ObjectId (post, comment, review or itinerary).' })
  @IsMongoId()
  id: string;
}
