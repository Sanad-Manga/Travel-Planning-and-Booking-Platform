import { ApiProperty } from '@nestjs/swagger';
import { ContentType, ReportStatus } from '../../common';

export class ReportResponseDto {
  @ApiProperty({ example: '674a1b2c3d4e5f6a7b8c9d0e' })
  id: string;

  @ApiProperty({
    example: '674a1b2c3d4e5f6a7b8c9d0f',
    description: 'The user who reported.',
  })
  reporterId: string;

  @ApiProperty({ enum: ContentType })
  targetType: ContentType;

  @ApiProperty({ example: '674a1b2c3d4e5f6a7b8c9d10' })
  targetId: string;

  @ApiProperty({ example: 'This post contains spam links.' })
  reason: string;

  @ApiProperty({ enum: ReportStatus, example: ReportStatus.OPEN })
  status: ReportStatus;

  @ApiProperty({ example: '2026-11-13T10:00:00.000Z' })
  createdAt: string;
}
