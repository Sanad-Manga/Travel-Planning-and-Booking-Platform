import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId } from 'class-validator';

export class HotelBookingIdParamDto {
  @ApiProperty({ example: '6730a1f2c3d4e5f607182950' })
  @IsMongoId({ message: 'id must be a valid id' })
  id: string;
}
