import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({ collection: 'attractions', timestamps: true })
export class Attraction {
  @Prop({ required: true, unique: true })
  attraction_id: string;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true, index: true })
  city_id: string;
}

export const AttractionSchema = SchemaFactory.createForClass(Attraction);
