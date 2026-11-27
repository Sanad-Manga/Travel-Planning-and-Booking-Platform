import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { PaginationDto } from '../../common';
import { PROVIDER_TYPES, ProviderType } from './provider-status.dto';

export class ListProvidersQueryDto extends PaginationDto {
  @ApiProperty({
    enum: PROVIDER_TYPES,
    description: 'Kind of provider to list.',
  })
  @IsIn(PROVIDER_TYPES)
  type: ProviderType;
}
