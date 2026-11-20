import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsMongoId } from 'class-validator';

export const PROVIDER_TYPES = ['hotel', 'airline'] as const;
export type ProviderType = (typeof PROVIDER_TYPES)[number];

export class ProviderStatusParamsDto {
  @ApiProperty({ enum: PROVIDER_TYPES, description: 'Kind of provider.' })
  @IsIn(PROVIDER_TYPES)
  type: ProviderType;

  @ApiProperty({ description: 'Hotel or airline ObjectId.' })
  @IsMongoId()
  id: string;
}

/** Neither operation accepts a body: a non-empty one is rejected by the global ValidationPipe (400). */
export class ProviderStatusBodyDto {}

export class ProviderStatusResponseDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: PROVIDER_TYPES }) type: ProviderType;
  @ApiProperty({
    description: 'false after deactivate, true after reactivate.',
  })
  isActive: boolean;
}
