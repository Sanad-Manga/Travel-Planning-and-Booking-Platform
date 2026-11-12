import { ApiProperty } from '@nestjs/swagger';
import { BudgetCategory, BudgetLean } from '../schemas/budget.schema';

export class BudgetDto {
  @ApiProperty({ example: '674a1b2c3d4e5f6a7b8c9d40' })
  id: string;

  @ApiProperty({ example: '674a1b2c3d4e5f6a7b8c9d0e' })
  itineraryId: string;

  @ApiProperty({
    example: '674a1b2c3d4e5f6a7b8c9d10',
    description: 'The day (of this itinerary) the entry is planned for',
  })
  dayId: string;

  @ApiProperty({ enum: BudgetCategory, example: BudgetCategory.FOOD })
  category: BudgetCategory;

  @ApiProperty({
    example: 2500,
    description: 'Amount in integer cents of `currency`. 0 is allowed.',
  })
  amountCents: number;

  @ApiProperty({ example: 'USD', description: 'A supported currency code' })
  currency: string;
}

/** Response DTO, never the raw document: `_id` becomes `id` and ids are strings. */
export function toBudgetDto(doc: BudgetLean): BudgetDto {
  return {
    id: doc._id.toString(),
    itineraryId: doc.itineraryId.toString(),
    dayId: doc.dayId.toString(),
    category: doc.category,
    amountCents: doc.amountCents,
    currency: doc.currency,
  };
}
