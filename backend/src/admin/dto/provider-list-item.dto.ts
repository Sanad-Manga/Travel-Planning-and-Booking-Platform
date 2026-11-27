import { ApiProperty } from '@nestjs/swagger';

export class ProviderListItemDto {
  @ApiProperty({ description: 'Provider ID as a string.' })
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ description: 'Whether the provider is active.' })
  isActive: boolean;
}
