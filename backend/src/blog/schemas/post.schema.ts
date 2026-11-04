import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { PostStatus } from '../../common';

/** An image already stored by the Upload service (GEN-08 / BLG-10): only id and url are kept. */
export class PostImage {
  id: string;
  url: string;
}

/**
 * Collection `posts`. Comments, likes (BLG-*), listing/search and Reports read these fields:
 * `status`, `authorId`, `tags`, `isHidden`, `createdAt`. Do not rename them without telling those tickets' owners.
 */
@Schema({ collection: 'posts', timestamps: true })
export class Post {
  // Reference to users._id. Always the logged-in user, never taken from the request body.
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  authorId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  title: string;

  @Prop({ required: true, trim: true })
  body: string;

  // Normalised (trim, lower-case, de-duplicated) by the DTO; max POST_MAX_TAGS.
  @Prop({ type: [String], default: [] })
  tags: string[];

  // Bounded child data, so embedded (max MAX_IMAGES_PER_ENTITY).
  @Prop({ type: [{ _id: false, id: { type: String, required: true }, url: { type: String, required: true } }], default: [] })
  images: PostImage[];

  // DRAFT is private to the author; only PUBLISHED posts are public.
  @Prop({ type: String, enum: Object.values(PostStatus), required: true, default: PostStatus.DRAFT })
  status: PostStatus;

  // Set when the post is first published (drives "newest published" ordering later).
  @Prop({ type: Date })
  publishedAt?: Date;

  // Hidden by a moderator (contracts section 7): visible only to the author and admins.
  @Prop({ default: false })
  isHidden: boolean;

  // Denormalised counters, kept up to date with $inc by the likes (BLG-05) and comments (BLG-06) code, so lists need no joins.
  @Prop({ type: Number, default: 0, min: 0 })
  likeCount: number;

  @Prop({ type: Number, default: 0, min: 0 })
  commentCount: number;

  createdAt?: Date;
  updatedAt?: Date;
}

export type PostDocument = HydratedDocument<Post>;
export const PostSchema = SchemaFactory.createForClass(Post);

// Public feed / search: published posts, newest first.
PostSchema.index({ status: 1, createdAt: -1 });
// "My blog": an author's posts by status, newest first.
PostSchema.index({ authorId: 1, status: 1, createdAt: -1 });
// Tag filter on published posts.
PostSchema.index({ tags: 1, status: 1 });
// Keyword search over title, body and tags.
PostSchema.index({ title: 'text', body: 'text', tags: 'text' });
