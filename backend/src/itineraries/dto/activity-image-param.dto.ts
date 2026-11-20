import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId } from 'class-validator';

export class ActivityImageParamDto {
  @ApiProperty({ example: '674a1b2c3d4e5f6a7b8c9d20' })
  @IsMongoId({ message: 'id must be a valid id' })
  id: string;

  @ApiProperty({ example: '674a1b2c3d4e5f6a7b8c9d50' })
  @IsMongoId({ message: 'imageId must be a valid id' })
  imageId: string;
}
