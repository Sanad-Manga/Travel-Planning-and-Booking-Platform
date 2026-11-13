import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId } from 'class-validator';

export class FlightIdParamDto {
  @ApiProperty({ example: '674a1b2c3d4e5f6a7b8c9d0e' })
  @IsMongoId({ message: 'id must be a valid id' })
  id: string;
}

export class CabinParamsDto extends FlightIdParamDto {
  @ApiProperty({ example: '674a1b2c3d4e5f6a7b8c9d0f' })
  @IsMongoId({ message: 'cabinId must be a valid id' })
  cabinId: string;
}
