import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  AuthenticatedUser,
  paginate,
  PaginatedResponse,
  PaginationDto,
  Role,
} from '../common';
import { AuditLogInput, prepareAuditInput } from './audit-input';
import {
  AuditLogResponseDto,
  toAuditLogResponse,
} from './dto/audit-log-response.dto';
import { AuditLog } from './schemas/audit-log.schema';

@Injectable()
export class AuditService {
  constructor(
    @InjectModel(AuditLog.name) private readonly records: Model<AuditLog>,
  ) {}

  async log(input: AuditLogInput): Promise<void> {
    const record = prepareAuditInput(input);
    try {
      await this.records.create(record);
    } catch {
      // No raw driver error/cause: the global filter logs 500 stacks.
      throw new InternalServerErrorException(
        'Audit record could not be persisted',
      );
    }
  }

  async list(
    user: AuthenticatedUser,
    pagination: PaginationDto,
  ): Promise<PaginatedResponse<AuditLogResponseDto>> {
    if (!user?.userId)
      throw new UnauthorizedException('Authentication required');
    if (user.role !== Role.ADMIN)
      throw new ForbiddenException('Administrator role required');
    try {
      return await paginate(this.records, {}, pagination, {
        sort: { createdAt: -1, _id: -1 },
        projection: 'actorId action targetType targetId details createdAt',
        map: toAuditLogResponse,
      });
    } catch {
      throw new InternalServerErrorException(
        'Audit records could not be retrieved',
      );
    }
  }
}
