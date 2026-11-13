import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsMongoId,
  IsNotEmpty,
  IsString,
  MaxLength,
} from 'class-validator';
import { ContentType } from '../../common';
import { REPORT_REASON_MAX_LENGTH } from '../reports.constants';

export class CreateReportDto {
  @ApiProperty({ enum: ContentType, example: ContentType.POST })
  @IsEnum(ContentType, {
    message: `targetType must be one of: ${Object.values(ContentType).join(', ')}`,
  })
  targetType: ContentType;

  @ApiProperty({
    example: '674a1b2c3d4e5f6a7b8c9d0e',
    description: 'The _id of the reported item.',
  })
  @IsMongoId({ message: 'targetId must be a valid id' })
  targetId: string;

  @ApiProperty({
    example: 'This post contains spam links.',
    maxLength: REPORT_REASON_MAX_LENGTH,
    description: 'Why the item is reported. Required, not blank.',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: 'reason must be text' })
  @IsNotEmpty({ message: 'reason is required' })
  @MaxLength(REPORT_REASON_MAX_LENGTH, {
    message: `reason must be at most ${REPORT_REASON_MAX_LENGTH} characters`,
  })
  reason: string;
}
