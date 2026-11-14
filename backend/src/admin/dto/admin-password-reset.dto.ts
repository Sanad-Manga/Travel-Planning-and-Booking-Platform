import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId } from 'class-validator';

/** Target account route parameter; role/status eligibility is also checked in the service. */
export class AdminPasswordResetParamsDto {
  @ApiProperty({
    description:
      'User or moderator account ObjectId. ADMIN targets are not supported.',
  })
  @IsMongoId()
  id: string;
}

/** The administrator does not choose or submit a password, role or status. */
export class AdminPasswordResetBodyDto {}
