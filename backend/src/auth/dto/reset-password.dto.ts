import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { PASSWORD_MIN_LENGTH } from '../../common';
import { RESET_TOKEN_ERROR_MESSAGE, RESET_TOKEN_MAX_LENGTH } from '../auth.constants';
import { IsValidPassword } from '../validators/password.decorator';

export class ResetPasswordDto {
  @ApiProperty({ description: 'The `token` query parameter of the link in the email.', example: 'k3J...base64url...' })
  @IsString({ message: RESET_TOKEN_ERROR_MESSAGE })
  @IsNotEmpty({ message: 'token should not be empty' })
  // A real token is 43 characters; the cap only stops a huge string from being hashed. Same message as every token error.
  @MaxLength(RESET_TOKEN_MAX_LENGTH, { message: RESET_TOKEN_ERROR_MESSAGE })
  token: string;

  @ApiProperty({
    example: 'N3wPassw0rd',
    minLength: PASSWORD_MIN_LENGTH,
    description: 'At least 8 characters, with at least one letter and one digit. At most 72 bytes in UTF-8.',
  })
  @IsValidPassword()
  newPassword: string;
}
