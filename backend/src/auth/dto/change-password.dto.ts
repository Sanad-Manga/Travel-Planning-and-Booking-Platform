import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
import { PASSWORD_MIN_LENGTH } from '../../common';
import { PASSWORD_MAX_BYTES } from '../auth.constants';
import { MaxByteLength } from '../validators/max-byte-length.decorator';
import { IsValidPassword } from '../validators/password.decorator';

export class ChangePasswordDto {
  // Only "not empty": the strength rules apply to the NEW password. Whether this one is correct is checked in the service.
  @ApiProperty({ example: 'Passw0rdOK', description: 'The password the user has now.' })
  @IsString()
  @IsNotEmpty({ message: 'currentPassword should not be empty' })
  // Same 72-byte cap as every password, so a huge string is never sent to bcrypt. No strength rules here.
  @MaxByteLength(PASSWORD_MAX_BYTES, { message: `currentPassword is too long (maximum ${PASSWORD_MAX_BYTES} bytes)` })
  currentPassword: string;

  @ApiProperty({
    example: 'N3wPassw0rd',
    minLength: PASSWORD_MIN_LENGTH,
    description: 'At least 8 characters, with at least one letter and one digit. At most 72 bytes in UTF-8.',
  })
  @IsValidPassword()
  newPassword: string;
}
