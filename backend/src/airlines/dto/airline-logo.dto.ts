import { ApiProperty } from '@nestjs/swagger';

/** The logo of an airline (GEN-08). Response only: the logo is added through POST /airlines/:id/logo. */
export class AirlineLogoDto {
  @ApiProperty({
    description: 'Id returned by the Upload service.',
    example: '6730a1f2c3d4e5f607182931',
  })
  id: string;

  @ApiProperty({
    description: 'Backend-relative url of the stored image.',
    example: '/uploads/6730a1f2c3d4e5f607182931.png',
  })
  url: string;
}
