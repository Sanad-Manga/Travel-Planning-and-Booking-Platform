import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/** A photo already stored by the Upload service (GEN-08): we keep only its id and url. */
export class HotelPhoto {
  id: string;
  url: string;
}

/**
 * Collection `hotels`. Rooms (HTL-03), policies (HTL-09/10) and bookings reference it by `_id`;
 * Hotels B search (HTL-11) and Admin (ACC-15) read `isActive`, `cityId`, `starRating` and `amenities`.
 * Do not rename these fields without telling those owners.
 */
@Schema({ collection: 'hotels', timestamps: true })
export class Hotel {
  @Prop({ required: true, trim: true })
  name: string;

  // Lower-cased name, only used to enforce "one hotel name per city" case-insensitively.
  @Prop({ required: true, select: false })
  nameKey: string;

  @Prop({ required: true, trim: true })
  address: string;

  // Reference to the seeded City (`city_id`). Never an invented id.
  @Prop({ required: true })
  cityId: string;

  // Copied from the seeded City (`country_code`) so search/filters need no join.
  @Prop({ required: true })
  countryCode: string;

  @Prop({ required: true, trim: true })
  description: string;

  // Bounded child data, so embedded (max MAX_IMAGES_PER_ENTITY).
  @Prop({ type: [{ _id: false, id: { type: String, required: true }, url: { type: String, required: true } }], default: [] })
  photos: HotelPhoto[];

  @Prop({ required: true, min: 1, max: 5 })
  starRating: number;

  @Prop({ type: [String], default: [] })
  amenities: string[];

  // false = deactivated by Admin (ACC-15): hidden from search and not bookable. This ticket never changes it.
  @Prop({ default: true })
  isActive: boolean;

  createdAt?: Date;
  updatedAt?: Date;
}

export type HotelDocument = HydratedDocument<Hotel>;
export const HotelSchema = SchemaFactory.createForClass(Hotel);

// Two hotels cannot share a name in the same city (case-insensitive via nameKey).
HotelSchema.index({ cityId: 1, nameKey: 1 }, { unique: true });
// Hotels B search: active hotels in a city, filtered by stars.
HotelSchema.index({ isActive: 1, cityId: 1, starRating: 1 });
