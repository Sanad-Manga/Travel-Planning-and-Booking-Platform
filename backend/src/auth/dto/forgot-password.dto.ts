import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail } from 'class-validator';

export class ForgotPasswordDto {
  // Normalized exactly like the login email, so "ALI@Example.com " finds the same account.
  @ApiProperty({ example: 'ali@example.com' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: 'email must be valid' })
  email: string;
}

export class ForgotPasswordResponseDto {
  @ApiProperty({ example: 'If the email is registered, a reset link has been sent.' })
  message: string;
}
