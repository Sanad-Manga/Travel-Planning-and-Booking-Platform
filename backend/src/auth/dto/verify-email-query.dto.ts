import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class VerifyEmailQueryDto {
  // One validator only, so a missing token is ONE field-level error. An empty or unknown value is
  // rejected by the service with the same generic "invalid or expired verification link".
  @ApiProperty({ description: 'The token from the verification link in the email.' })
  @IsString({ message: 'token is required' })
  token: string;
}
