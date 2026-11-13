import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AuthenticatedUser, ReportStatus } from '../common';
import { ContentLookupService } from './content-lookup.service';
import { CreateReportDto } from './dto/create-report.dto';
import { ReportResponseDto } from './dto/report-response.dto';
import { Report, ReportDocument } from './schemas/report.schema';

const MONGO_DUPLICATE_KEY = 11000;

@Injectable()
export class ReportsService {
  constructor(
    @InjectModel(Report.name) private readonly reports: Model<Report>,
    private readonly content: ContentLookupService,
  ) {}

  /**
   * GEN-09. The target must exist and be visible to the reporter (404 otherwise). The one-report-per-user-per-item
   * rule is the unique index: two parallel requests both pass the lookup, one insert wins, the other gets 409.
   */
  async create(
    user: AuthenticatedUser,
    dto: CreateReportDto,
  ): Promise<ReportResponseDto> {
    if (!(await this.content.isReportable(dto.targetType, dto.targetId))) {
      throw new NotFoundException(`${dto.targetType} not found`);
    }
    try {
      const report = await this.reports.create({
        reporterId: user.userId,
        targetType: dto.targetType,
        targetId: dto.targetId,
        reason: dto.reason,
        status: ReportStatus.OPEN,
      });
      return toResponse(report);
    } catch (error) {
      if ((error as { code?: unknown })?.code === MONGO_DUPLICATE_KEY) {
        throw new ConflictException({
          message: 'You have already reported this item',
          details: [
            {
              field: 'targetId',
              message: 'you have already reported this item',
            },
          ],
        });
      }
      throw error;
    }
  }
}

function toResponse(report: ReportDocument): ReportResponseDto {
  return {
    id: String(report._id),
    reporterId: String(report.reporterId),
    targetType: report.targetType,
    targetId: String(report.targetId),
    reason: report.reason,
    status: report.status,
    createdAt: (report.createdAt ?? new Date()).toISOString(),
  };
}
