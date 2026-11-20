import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { PaginationDto } from '../../common';

export class ListNotificationsDto extends PaginationDto {
  @ApiPropertyOptional({
    description: 'false = only unread, true = only read. Omit for all.',
  })
  @IsOptional()
  // Query strings arrive as text. `@Type(() => Boolean)` would turn "false" into true, so convert by hand.
  @Transform(({ value }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  isRead?: boolean;
}
