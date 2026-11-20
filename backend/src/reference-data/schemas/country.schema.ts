import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({ collection: 'countries', timestamps: true })
export class Country {
  @Prop({ required: true, unique: true })
  code: string;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true, index: true })
  currency: string;
}

export const CountrySchema = SchemaFactory.createForClass(Country);
