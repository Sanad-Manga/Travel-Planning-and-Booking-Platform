import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({ collection: 'currencies', timestamps: true })
export class Currency {
  @Prop({ required: true, unique: true })
  code: string;
}

export const CurrencySchema = SchemaFactory.createForClass(Currency);
