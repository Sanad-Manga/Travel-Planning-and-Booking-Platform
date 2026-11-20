import { ApiProperty } from '@nestjs/swagger';

export class DeactivateAccountResponseDto {
  @ApiProperty({ example: 'Account deactivated' })
  message: string;
}
