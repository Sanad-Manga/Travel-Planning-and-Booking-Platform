import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AuthenticatedUser, PaginatedResponse, PaginationDto, ReportStatus, Role, paginate } from '../common';
import { AuditService } from '../audit/audit.service';
import { Report } from '../reports/schemas/report.schema';
import { AdminContentService } from './admin-content.service';
import { ReportRowDto, toReportRow } from './dto/report-row.dto';
import { ReportResolution, ResolveReportDto } from './dto/resolve-report.dto';

const RESOLUTION_TO_STATUS: Record<ReportResolution, ReportStatus> = {
  [ReportResolution.DISMISS]: ReportStatus.DISMISSED,
  [ReportResolution.HIDE]: ReportStatus.HIDDEN,
  [ReportResolution.DELETE]: ReportStatus.DELETED,
};

/**
 * GEN-10: the admin side of GEN-09's reports. Reuses the `Report` schema class directly (same
 * pattern `ReportsModule` itself already uses for `Post`/`Itinerary` read-only lookups) rather than
 * editing `reports/` files, which aren't mine.
 */
@Injectable()
export class ReportsAdminService {
  constructor(
    @InjectModel(Report.name) private readonly reports: Model<Report>,
    private readonly content: AdminContentService,
    private readonly audit: AuditService,
  ) {}

  /** Open reports, newest first — the exact shape `ReportSchema`'s `{status, createdAt}` index was built for. */
  async list(actor: AuthenticatedUser, query: PaginationDto): Promise<PaginatedResponse<ReportRowDto>> {
    this.assertAdmin(actor);
    return paginate(this.reports, { status: ReportStatus.OPEN }, query, {
      sort: { createdAt: -1 },
      projection: 'reporterId targetType targetId reason status createdAt',
      map: toReportRow,
    });
  }

  /**
   * Atomically claims the report (filtered on `status: OPEN`, so two concurrent resolutions of the
   * same report cannot both succeed — the loser gets 409, satisfying "resolving an already-resolved
   * report is rejected" without a read-then-write race), then applies the resolution to the content.
   *
   * KNOWN GAP: the report-status flip and the content mutation are not transactional across the
   * `reports`/`posts`/`comments`/`itineraries` collections (no cross-module transaction is used for
   * this anywhere in this codebase either — `BlogService.deletePostAndDependents` documents the same
   * limitation for its own single-module cascade). If the content mutation throws after the report
   * is claimed, the report is left resolved with the content still live; flagged in the PR.
   */
  async resolve(actor: AuthenticatedUser, id: string, dto: ResolveReportDto): Promise<ReportRowDto> {
    this.assertAdmin(actor);

    const newStatus = RESOLUTION_TO_STATUS[dto.resolution];
    const report = await this.reports
      .findOneAndUpdate({ _id: id, status: ReportStatus.OPEN }, { status: newStatus })
      .lean();

    if (!report) {
      const exists = await this.reports.exists({ _id: id }).exec();
      if (!exists) throw new NotFoundException('Report not found');
      throw new ConflictException('Report is already resolved');
    }

    if (dto.resolution === ReportResolution.HIDE) {
      await this.content.hide(actor, report.targetType, String(report.targetId));
    } else if (dto.resolution === ReportResolution.DELETE) {
      await this.content.delete(actor, report.targetType, String(report.targetId));
    }

    await this.audit.log({
      actorId: actor.userId,
      action:
        dto.resolution === ReportResolution.DISMISS
          ? 'REPORT_DISMISSED'
          : dto.resolution === ReportResolution.HIDE
            ? 'REPORT_RESOLVED_HIDDEN'
            : 'REPORT_RESOLVED_DELETED',
      targetType: report.targetType,
      targetId: String(report.targetId),
      details: { reportId: id, resolution: dto.resolution },
    });

    return toReportRow({ ...report, status: newStatus });
  }

  private assertAdmin(actor: AuthenticatedUser): void {
    if (actor.role !== Role.ADMIN) throw new ForbiddenException('Administrator role required');
  }
}
