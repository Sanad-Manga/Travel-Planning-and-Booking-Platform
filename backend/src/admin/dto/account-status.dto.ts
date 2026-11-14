import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId } from 'class-validator';
import { AccountStatus } from '../../common';

export class AccountStatusParamsDto {
  @ApiProperty({ description: 'Registered USER account ObjectId.' })
  @IsMongoId()
  id: string;
}

/** Neither operation accepts status, role, target IDs or other body fields. */
export class AccountStatusBodyDto {}

export class AccountStatusResponseDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: AccountStatus }) status: AccountStatus;
}
