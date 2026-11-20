import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

/**
 * ITN-18: one day's exchange rates, fetched once from FXRatesAPI and cached here. `rates` is
 * relative to `base` (1 unit of `base` = `rates.get(code)` units of `code`) — always
 * PLATFORM_CURRENCY today, since that is the only stable anchor other modules already use.
 */
@Schema({ collection: 'exchangeRates', timestamps: true })
export class ExchangeRate {
  @Prop({ required: true })
  base: string;

  /** YYYY-MM-DD, the date FXRatesAPI reported these rates for. */
  @Prop({ required: true })
  rateDate: string;

  @Prop({ type: Map, of: Number, required: true })
  rates: Map<string, number>;
}

export type ExchangeRateDocument = HydratedDocument<ExchangeRate>;

/**
 * As returned by `.lean()` (timestamps: true adds createdAt / updatedAt). Mongoose's default
 * lean option `flattenMaps: true` turns the `Map` field into a plain object on a lean read, so
 * `rates` is `Record<string, number>` here, not `Map<string, number>` as on the schema class.
 */
export type ExchangeRateLean = Omit<ExchangeRate, 'rates'> & {
  _id: Types.ObjectId;
  rates: Record<string, number>;
  createdAt: Date;
  updatedAt: Date;
};

export const ExchangeRateSchema = SchemaFactory.createForClass(ExchangeRate);

// One fetch per base per day: a second fetch the same day must never create a duplicate cache row.
ExchangeRateSchema.index({ base: 1, rateDate: 1 }, { unique: true });
// The "API is down, use the last cached rates" fallback: most recent row for this base, any age.
ExchangeRateSchema.index({ base: 1, createdAt: -1 });
