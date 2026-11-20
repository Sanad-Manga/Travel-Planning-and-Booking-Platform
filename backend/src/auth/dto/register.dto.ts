import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { Equals, IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { PASSWORD_MIN_LENGTH } from '../../common';
import { IsValidPassword } from '../validators/password.decorator';

// Runs before validation: " Ali@Mail.COM " becomes "ali@mail.com". Non-strings are left for the validators to reject.
const trimString = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const normalizeEmail = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);

export class RegisterDto {
  @ApiProperty({ example: 'Ali Hassan', maxLength: 100 })
  @Transform(trimString)
  @IsString()
  @IsNotEmpty({ message: 'name should not be empty' })
  @MaxLength(100)
  name: string;

  @ApiProperty({ example: 'ali@example.com' })
  @Transform(normalizeEmail)
  @IsEmail({}, { message: 'email must be valid' })
  @MaxLength(254)
  email: string;

  @ApiProperty({
    example: 'Passw0rdOK',
    minLength: PASSWORD_MIN_LENGTH,
    description: 'At least 8 characters, with at least one letter and one digit. At most 72 bytes in UTF-8.',
  })
  // The shared rule (also used by change password and the admin reset): see validators/password.decorator.ts.
  @IsValidPassword()
  password: string;

  @ApiProperty({ example: true, description: 'Must be true: the user accepts the terms and the privacy policy.' })
  @Equals(true, { message: 'You must accept the terms and the privacy policy' })
  acceptTerms: boolean;
}
