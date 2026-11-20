import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';

/** What the admin is asking for. Decoupled from the stored ReportStatus wire-for-wire, even
 * though today DISMISS/HIDE/DELETE map 1:1 onto DISMISSED/HIDDEN/DELETED. */
export enum ReportResolution {
  DISMISS = 'DISMISS',
  HIDE = 'HIDE',
  DELETE = 'DELETE',
}

export class ResolveReportDto {
  @ApiProperty({ enum: ReportResolution, example: ReportResolution.HIDE })
  @IsEnum(ReportResolution, {
    message: `resolution must be one of: ${Object.values(ReportResolution).join(', ')}`,
  })
  resolution: ReportResolution;
}
