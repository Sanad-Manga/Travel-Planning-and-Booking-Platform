import { ApiProperty } from '@nestjs/swagger';
import { Types } from 'mongoose';
import { AccountStatus, Role } from '../../common';
import { User } from '../../users/schemas/user.schema';

export class AccountResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() email: string;
  @ApiProperty({ enum: Role }) role: Role;
  @ApiProperty({ enum: AccountStatus }) status: AccountStatus;
  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'Registration timestamp, ISO 8601 UTC.',
  })
  createdAt: string;
}

type AccountRow = Pick<User, 'name' | 'email' | 'role' | 'status'> & {
  _id: Types.ObjectId;
  createdAt: Date;
};
export function toAccountResponse(user: AccountRow): AccountResponseDto {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt.toISOString(),
  };
}
