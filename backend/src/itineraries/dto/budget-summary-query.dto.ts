import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, Matches } from 'class-validator';

const trimAndUpperCase = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

/**
 * Query of GET /api/itineraries/:id/budget-summary (ITN-18). Defaults to the caller's
 * preferred currency (ACC-09) when omitted.
 */
export class BudgetSummaryQueryDto {
  @ApiPropertyOptional({
    example: 'EUR',
    description:
      "Convert the budget total to this currency. Defaults to the caller's preferred currency.",
  })
  @IsOptional()
  @Transform(trimAndUpperCase)
  @Matches(/^[A-Z]{3}$/, {
    message: 'currency must be a 3-letter currency code',
  })
  currency?: string;
}
