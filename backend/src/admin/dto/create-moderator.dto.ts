import { ApiProperty, ApiPropertyOptional, PickType } from '@nestjs/swagger';
import { IsIn, IsMongoId, IsOptional } from 'class-validator';
import { RegisterDto } from '../../auth/dto/register.dto';
import { IsValidPassword } from '../../auth/validators/password.decorator';
import { PASSWORD_MIN_LENGTH, Role } from '../../common';

/** The only roles this route can create. USER and ADMIN are never accepted. */
export const MODERATOR_ROLES = [Role.AIRLINE_MODERATOR, Role.HOTEL_MODERATOR] as const;

/**
 * Body of POST /api/admin/moderators (ACC-13).
 * `name` and `email` are picked from RegisterDto, so they follow exactly the registration rules and the
 * same normalization (trim, lowercase e-mail). The password rule is the shared @IsValidPassword().
 * The "exactly one of airlineId/hotelId, matching the role" rule needs two fields at once, so it is a business
 * rule checked in the service (a 400 with one `details` entry per field).
 */
export class CreateModeratorDto extends PickType(RegisterDto, ['name', 'email'] as const) {
  @ApiProperty({ enum: MODERATOR_ROLES, example: Role.HOTEL_MODERATOR })
  @IsIn(MODERATOR_ROLES, { message: `role must be one of: ${MODERATOR_ROLES.join(', ')}` })
  role: (typeof MODERATOR_ROLES)[number];

  @ApiProperty({
    example: 'Temp0rary9Pass',
    minLength: PASSWORD_MIN_LENGTH,
    description:
      'Temporary password chosen by the admin. Same rules as every password (8+ chars, a letter and a digit, at most 72 bytes). ' +
      'It is valid for ONE login within 24 hours; the moderator must then replace it. Never returned by the API.',
  })
  @IsValidPassword()
  temporaryPassword: string;

  @ApiPropertyOptional({
    description: 'Required for AIRLINE_MODERATOR, forbidden for HOTEL_MODERATOR. Id of an existing airline.',
    example: '6730a1f2c3d4e5f607182931',
  })
  @IsOptional()
  @IsMongoId({ message: 'airlineId must be a valid id' })
  airlineId?: string;

  @ApiPropertyOptional({
    description: 'Required for HOTEL_MODERATOR, forbidden for AIRLINE_MODERATOR. Id of an existing hotel.',
    example: '6730a1f2c3d4e5f607182932',
  })
  @IsOptional()
  @IsMongoId({ message: 'hotelId must be a valid id' })
  hotelId?: string;
}
