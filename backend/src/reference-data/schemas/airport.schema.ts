import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({ collection: 'airports', timestamps: true })
export class Airport {
  @Prop({ required: true, unique: true })
  iata_code: string;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true, index: true })
  city_id: string;

  @Prop({ required: true, index: true })
  country_code: string;

  @Prop({ required: true })
  time_zone: string;
}

export const AirportSchema = SchemaFactory.createForClass(Airport);
