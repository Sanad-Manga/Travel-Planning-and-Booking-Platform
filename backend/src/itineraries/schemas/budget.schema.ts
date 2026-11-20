import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

/**
 * What a daily budget entry is for (ITN-14). Exactly these four are allowed on an entry. Activity costs (ITN-10)
 * are counted under ACTIVITIES in the summary; intercity transport (ITN-16) has its own line there.
 */
export enum BudgetCategory {
  FOOD = 'FOOD',
  ACCOMMODATION = 'ACCOMMODATION',
  IN_CITY_TRANSPORT = 'IN_CITY_TRANSPORT',
  ACTIVITIES = 'ACTIVITIES',
}

/**
 * One daily budget entry of an itinerary (ITN-14), collection `budgets`. It has its own collection because the API
 * addresses it by its own id (PATCH/DELETE /api/budgets/:id) and the budget summary adds the entries up.
 */
@Schema({ timestamps: true, collection: 'budgets' })
export class Budget {
  /** The itinerary it belongs to. Deleting the itinerary deletes its entries. */
  @Prop({ type: Types.ObjectId, ref: 'Itinerary', required: true })
  itineraryId: Types.ObjectId;

  /** The `_id` of the embedded day (ITN-05) the entry is planned for. Deleting the day deletes the entry. */
  @Prop({ type: Types.ObjectId, required: true })
  dayId: Types.ObjectId;

  /**
   * The itinerary's author, copied here when the entry is created. An itinerary never changes owner, so the copy
   * cannot go stale. It lets edit and delete check ownership inside ONE atomic query (`_id` AND `ownerId`).
   */
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  ownerId: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(BudgetCategory), required: true })
  category: BudgetCategory;

  /** Integer cents (contracts section 3), never a float. 0 is allowed. */
  @Prop({
    type: Number,
    required: true,
    min: 0,
    validate: {
      validator: Number.isInteger,
      message: 'amountCents must be a whole number of cents',
    },
  })
  amountCents: number;

  /** A supported currency code (GEN-12). ITN-18 converts the totals; nothing is converted here. */
  @Prop({ type: String, required: true })
  currency: string;
}

export type BudgetDocument = HydratedDocument<Budget>;

/** An entry as returned by `.lean()`. */
export type BudgetLean = Budget & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const BudgetSchema = SchemaFactory.createForClass(Budget);

// "All entries of an itinerary" (shown on the itinerary, deleted with it, summed by the summary); a day's entries
// are deleted with the day.
BudgetSchema.index({ itineraryId: 1, dayId: 1 });
