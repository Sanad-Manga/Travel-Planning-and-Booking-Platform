import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId } from 'class-validator';

export class ReportIdParamsDto {
  @ApiProperty({ description: 'Report ObjectId.' })
  @IsMongoId()
  id: string;
}
