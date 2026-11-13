import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId } from 'class-validator';

export class BudgetIdParamDto {
  @ApiProperty({ example: '674a1b2c3d4e5f6a7b8c9d40' })
  @IsMongoId({ message: 'id must be a valid id' })
  id: string;
}
