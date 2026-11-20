import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({ collection: 'cities', timestamps: true })
export class City {
  @Prop({ required: true, unique: true })
  city_id: string;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true, index: true })
  country_code: string;
}

export const CitySchema = SchemaFactory.createForClass(City);
