import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { safeAuditDetails } from '../audit-input';
import { AuditLogLean } from '../schemas/audit-log.schema';

export class AuditLogResponseDto {
  @ApiProperty({ description: 'MongoDB identifier exposed as a string.' })
  id: string;

  @ApiProperty({
    description:
      'Authenticated actor identifier supplied by the trusted action service.',
  })
  actorId: string;

  @ApiProperty({ example: 'USER_SUSPENDED' })
  action: string;

  @ApiProperty({ example: 'User' })
  targetType: string;

  @ApiProperty({
    description:
      'Original target identifier; not restricted to MongoDB ObjectIds.',
    example: 'CAI',
  })
  targetId: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    example: { reason: 'Violation of community rules' },
    description:
      'Safe administrative JSON context; never credentials, cookies, tokens or card data.',
  })
  details?: Record<string, unknown>;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'Server-generated action-record timestamp in ISO 8601 UTC.',
  })
  createdAt: string;
}

export function toAuditLogResponse(record: AuditLogLean): AuditLogResponseDto {
  const details = safeAuditDetails(record.details);
  return {
    id: record._id.toString(),
    actorId: record.actorId,
    action: record.action,
    targetType: record.targetType,
    targetId: record.targetId,
    ...(details !== undefined ? { details } : {}),
    createdAt: record.createdAt.toISOString(),
  };
}
