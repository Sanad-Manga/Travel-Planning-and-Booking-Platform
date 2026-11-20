import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { AccountStatus } from '../../common';

/** Admin-owned retry metadata; never added to the shared User/Audit schemas. */
@Schema({ collection: 'accountStatusOperations', timestamps: true })
export class AccountStatusOperation {
  _id: Types.ObjectId;
  @Prop({ required: true }) actorId: string;
  @Prop({ required: true }) targetId: string;
  @Prop({ required: true, enum: Object.values(AccountStatus) })
  from: AccountStatus;
  @Prop({ required: true, enum: Object.values(AccountStatus) })
  to: AccountStatus;
  @Prop({ default: false }) audited: boolean;
  @Prop({ default: false }) notificationAttempted: boolean;
  @Prop({ default: false }) complete: boolean;
  @Prop() leaseToken?: string;
  @Prop() leaseUntil?: Date;
}
export const AccountStatusOperationSchema = SchemaFactory.createForClass(
  AccountStatusOperation,
);
AccountStatusOperationSchema.index({ targetId: 1, complete: 1, _id: 1 });
