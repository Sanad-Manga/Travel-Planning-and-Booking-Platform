import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AccountStatus, Role } from '../../common';
import { UserDocument } from '../../users/schemas/user.schema';

/** What the API returns for a user. Never includes the password hash. `_id` is exposed as `id`. */
export class UserResponseDto {
  @ApiProperty({ example: '6730a1f2c3d4e5f607182930' })
  id: string;

  @ApiProperty({ example: 'Ali Hassan' })
  name: string;

  @ApiProperty({ example: 'ali@example.com' })
  email: string;

  @ApiProperty({ enum: Role, example: Role.USER })
  role: Role;

  @ApiProperty({ enum: AccountStatus, example: AccountStatus.ACTIVE })
  status: AccountStatus;

  @ApiPropertyOptional({ description: 'Only for airline moderators.' })
  airlineId?: string;

  @ApiPropertyOptional({ description: 'Only for hotel moderators.' })
  hotelId?: string;

  @ApiProperty({ example: 'USD' })
  preferredCurrency: string;

  @ApiProperty({ example: '2026-11-03T10:00:00.000Z' })
  consentAcceptedAt: string;

  @ApiProperty({ example: '2026-11-03T10:00:00.000Z' })
  createdAt: string;

  static from(user: UserDocument): UserResponseDto {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
      ...(user.airlineId ? { airlineId: user.airlineId.toString() } : {}),
      ...(user.hotelId ? { hotelId: user.hotelId.toString() } : {}),
      preferredCurrency: user.preferredCurrency,
      consentAcceptedAt: user.consentAcceptedAt.toISOString(),
      createdAt: (user.createdAt ?? new Date()).toISOString(),
    };
  }
}
