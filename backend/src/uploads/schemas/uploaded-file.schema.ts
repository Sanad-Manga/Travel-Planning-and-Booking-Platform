import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { UPLOAD_KINDS, UploadKind } from '../upload.types';

@Schema({ collection: 'uploadedFiles', timestamps: true })
export class UploadedFile {
  _id: Types.ObjectId;
  @Prop({ required: true, enum: UPLOAD_KINDS }) kind: UploadKind;
  @Prop({ required: true }) ownerId: string;
  @Prop({ required: true, min: 1, max: 5 }) slot: number;
  @Prop({ required: true }) active: boolean;
  @Prop({ required: true, enum: ['pending', 'ready', 'deleting', 'cleanup'] })
  state: 'pending' | 'ready' | 'deleting' | 'cleanup';
  @Prop() leaseUntil?: Date;
  @Prop({ required: true }) storageKey: string;
  @Prop({ required: true, enum: ['image/jpeg', 'image/png'] })
  contentType: string;
  @Prop({ required: true }) sizeBytes: number;
  createdAt: Date;
  updatedAt: Date;
}

export const UploadedFileSchema = SchemaFactory.createForClass(UploadedFile);
UploadedFileSchema.index(
  { kind: 1, ownerId: 1, slot: 1 },
  { unique: true, partialFilterExpression: { active: true } },
);
UploadedFileSchema.index({ state: 1, leaseUntil: 1 });
