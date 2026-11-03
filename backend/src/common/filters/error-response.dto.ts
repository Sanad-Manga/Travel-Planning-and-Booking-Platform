import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ErrorDetailDto {
  @ApiProperty({ example: 'email' })
  field: string;

  @ApiProperty({ example: 'email must be valid' })
  message: string;
}

/** Every error the API returns has this shape (docs/contracts.md section 3). Use it in `@ApiResponse` decorators. */
export class ErrorResponseDto {
  @ApiProperty({ example: 400 })
  statusCode: number;

  @ApiProperty({ example: 'Bad Request' })
  error: string;

  @ApiProperty({ example: 'Validation failed' })
  message: string;

  @ApiPropertyOptional({ type: [ErrorDetailDto] })
  details?: ErrorDetailDto[];

  @ApiProperty({ example: '/api/auth/register' })
  path: string;

  @ApiProperty({ example: '2026-11-02T10:00:00.000Z' })
  timestamp: string;
}
