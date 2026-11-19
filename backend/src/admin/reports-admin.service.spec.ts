import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Model, Types } from 'mongoose';
import { AuthenticatedUser, ContentType, ReportStatus, Role } from '../common';
import { AuditService } from '../audit/audit.service';
import { AdminContentService } from './admin-content.service';
import { ReportResolution } from './dto/resolve-report.dto';
import { ReportsAdminService } from './reports-admin.service';
import { Report } from '../reports/schemas/report.schema';

const REPORT_ID = new Types.ObjectId().toString();
const REPORTER_ID = new Types.ObjectId();
const TARGET_ID = new Types.ObjectId();

function admin(): AuthenticatedUser {
  return { userId: new Types.ObjectId().toString(), role: Role.ADMIN };
}

function user(): AuthenticatedUser {
  return { userId: new Types.ObjectId().toString(), role: Role.USER };
}

function openReport(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    _id: REPORT_ID,
    reporterId: REPORTER_ID,
    targetType: ContentType.POST,
    targetId: TARGET_ID,
    reason: 'spam',
    status: ReportStatus.OPEN,
    createdAt: new Date('2026-11-19T10:00:00.000Z'),
    ...overrides,
  };
}

describe('ReportsAdminService', () => {
  let reports: { findOneAndUpdate: jest.Mock; exists: jest.Mock; find: jest.Mock; countDocuments: jest.Mock };
  let content: { hide: jest.Mock; delete: jest.Mock };
  let audit: { log: jest.Mock };
  let service: ReportsAdminService;

  beforeEach(() => {
    reports = {
      findOneAndUpdate: jest.fn(),
      exists: jest.fn(),
      find: jest.fn(),
      countDocuments: jest.fn(),
    };
    content = { hide: jest.fn().mockResolvedValue(undefined), delete: jest.fn().mockResolvedValue(undefined) };
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    service = new ReportsAdminService(
      reports as unknown as Model<Report>,
      content as unknown as AdminContentService,
      audit as unknown as AuditService,
    );
  });

  describe('list', () => {
    it('rejects a non-admin caller', async () => {
      await expect(service.list(user(), { page: 1, limit: 10 })).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lists only OPEN reports, newest first', async () => {
      const row = openReport();
      reports.find.mockReturnValue({
        sort: () => ({ skip: () => ({ limit: () => ({ lean: () => ({ exec: async () => [row] }) }) }) }),
      });
      reports.countDocuments.mockReturnValue({ exec: async () => 1 });

      const page = await service.list(admin(), { page: 1, limit: 10 });

      expect(page.items).toEqual([
        {
          id: REPORT_ID,
          reporterId: REPORTER_ID.toString(),
          targetType: ContentType.POST,
          targetId: TARGET_ID.toString(),
          reason: 'spam',
          status: ReportStatus.OPEN,
          createdAt: '2026-11-19T10:00:00.000Z',
        },
      ]);
      expect(reports.find.mock.calls[0][0]).toEqual({ status: ReportStatus.OPEN });
    });
  });

  describe('resolve', () => {
    it('rejects a non-admin caller', async () => {
      await expect(
        service.resolve(user(), REPORT_ID, { resolution: ReportResolution.DISMISS }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('dismisses a report without touching any content', async () => {
      reports.findOneAndUpdate.mockReturnValue({ lean: async () => openReport() });

      const result = await service.resolve(admin(), REPORT_ID, { resolution: ReportResolution.DISMISS });

      expect(result.status).toBe(ReportStatus.DISMISSED);
      expect(content.hide).not.toHaveBeenCalled();
      expect(content.delete).not.toHaveBeenCalled();
      expect(audit.log).toHaveBeenCalledWith({
        actorId: expect.any(String),
        action: 'REPORT_DISMISSED',
        targetType: ContentType.POST,
        targetId: TARGET_ID.toString(),
        details: { reportId: REPORT_ID, resolution: ReportResolution.DISMISS },
      });
    });

    it('hides the reported content and records the resolution', async () => {
      reports.findOneAndUpdate.mockReturnValue({ lean: async () => openReport() });

      const result = await service.resolve(admin(), REPORT_ID, { resolution: ReportResolution.HIDE });

      expect(result.status).toBe(ReportStatus.HIDDEN);
      expect(content.hide).toHaveBeenCalledWith(expect.anything(), ContentType.POST, TARGET_ID.toString());
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'REPORT_RESOLVED_HIDDEN' }));
    });

    it('deletes the reported content and records the resolution', async () => {
      reports.findOneAndUpdate.mockReturnValue({ lean: async () => openReport() });

      const result = await service.resolve(admin(), REPORT_ID, { resolution: ReportResolution.DELETE });

      expect(result.status).toBe(ReportStatus.DELETED);
      expect(content.delete).toHaveBeenCalledWith(expect.anything(), ContentType.POST, TARGET_ID.toString());
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'REPORT_RESOLVED_DELETED' }));
    });

    it('rejects resolving an already-resolved report with 409, atomically (no read-then-write)', async () => {
      reports.findOneAndUpdate.mockReturnValue({ lean: async () => null });
      reports.exists.mockReturnValue({ exec: async () => true });

      await expect(
        service.resolve(admin(), REPORT_ID, { resolution: ReportResolution.DISMISS }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(content.hide).not.toHaveBeenCalled();
      expect(content.delete).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('answers 404 for an unknown report id', async () => {
      reports.findOneAndUpdate.mockReturnValue({ lean: async () => null });
      reports.exists.mockReturnValue({ exec: async () => false });

      await expect(
        service.resolve(admin(), REPORT_ID, { resolution: ReportResolution.DISMISS }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
