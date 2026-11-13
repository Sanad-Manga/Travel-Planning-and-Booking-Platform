import { ApiProperty } from '@nestjs/swagger';
import { Equals } from 'class-validator';

/**
 * Body of DELETE /api/users/me (ACC-12). The only field is the explicit confirmation, and it must be the
 * boolean `true`: missing, `false`, "true" (a string) or 1 are all rejected with a field-level 400.
 */
export class DeactivateAccountDto {
  @ApiProperty({
    example: true,
    enum: [true],
    description: 'Must be exactly the boolean true: the user confirms that the account will be deactivated.',
  })
  @Equals(true, { message: 'confirm must be true to deactivate your account' })
  confirm: true;
}
