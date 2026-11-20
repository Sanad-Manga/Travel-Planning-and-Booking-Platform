import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';
import { normalizePhone, PHONE_PATTERN } from './phone';

const trimString = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const normalizeCurrency = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value);

// Every field is optional, but when it IS present (even as null) it must be valid: null is rejected, not ignored.
const whenProvided = () => ValidateIf((_object, value) => value !== undefined);

/**
 * PATCH /api/users/me. Only these three fields can be edited. email, role, status, airlineId, hotelId and the
 * password are deliberately NOT here: the global pipe (whitelist + forbidNonWhitelisted) rejects them with 400.
 */
export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Ali Hassan', maxLength: 100 })
  @whenProvided()
  @Transform(trimString)
  @IsString()
  @IsNotEmpty({ message: 'name should not be empty' })
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({
    example: '+20 100 123 4567',
    description:
      'Optional "+" and 7 to 15 digits; spaces, dashes, dots and parentheses are removed before saving. Send an empty string to remove the phone number.',
  })
  @whenProvided()
  @Transform(({ value }) => normalizePhone(value))
  @IsString()
  @Matches(PHONE_PATTERN, { message: 'phone must be 7 to 15 digits with an optional leading +' })
  phone?: string;

  @ApiPropertyOptional({
    example: 'EUR',
    description: 'A supported currency code (3 letters, case-insensitive; saved in upper case). Checked against the currencies reference data.',
  })
  @whenProvided()
  @Transform(normalizeCurrency)
  @IsString()
  @Matches(/^[A-Z]{3}$/, { message: 'preferredCurrency must be a 3-letter currency code' })
  preferredCurrency?: string;
}
