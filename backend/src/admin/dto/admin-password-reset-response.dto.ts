import { ApiProperty } from '@nestjs/swagger';

/** One ADMIN-only, no-store response; never reuse this DTO for user/profile responses. */
export class AdminPasswordResetResponseDto {
  @ApiProperty({ description: 'Target account ID.' })
  id: string;

  @ApiProperty({
    description:
      'Generated secret disclosed only in this ADMIN response with Cache-Control: no-store. It permits one successful login before expiration; the resulting session requires password replacement. Never log or persist plaintext.',
  })
  temporaryPassword: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description:
      'UTC expiration, 24 hours after temporary-password generation.',
  })
  expiresAt: string;
}
