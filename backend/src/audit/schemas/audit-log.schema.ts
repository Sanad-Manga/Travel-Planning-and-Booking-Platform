import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, Types } from 'mongoose';

@Schema({ collection: 'auditLogs', timestamps: true })
export class AuditLog {
  @Prop({ type: String, required: true })
  actorId: string;

  @Prop({ type: String, required: true })
  action: string;

  @Prop({ type: String, required: true })
  targetType: string;

  @Prop({ type: String, required: true })
  targetId: string;

  @Prop({ type: MongooseSchema.Types.Mixed })
  details?: Record<string, unknown>;

  createdAt: Date;
  updatedAt: Date;
}

export type AuditLogLean = AuditLog & { _id: Types.ObjectId };
export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);
AuditLogSchema.index({ createdAt: -1, _id: -1 });
