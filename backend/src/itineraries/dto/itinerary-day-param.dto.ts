import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId } from 'class-validator';
import { ItineraryIdParamDto } from './itinerary-id-param.dto';

export class ItineraryDayParamDto extends ItineraryIdParamDto {
  @ApiProperty({ example: '674a1b2c3d4e5f6a7b8c9d10' })
  @IsMongoId({ message: 'dayId must be a valid id' })
  dayId: string;
}
