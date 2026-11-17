import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from '../users/users.module';
import { UploadsModule } from '../uploads';
import { PostImagesController } from './post-images.controller';
import { PostImagesService } from './post-images.service';
import { BlogController } from './blog.controller';
import { BlogService } from './blog.service';
import { CommentItemController } from './comment-item.controller';
import { CommentsController } from './comments.controller';
import { CommentsService } from './comments.service';
import { Comment, CommentSchema } from './schemas/comment.schema';
import { Like, LikeSchema } from './schemas/like.schema';
import { Post, PostSchema } from './schemas/post.schema';
import { TagsController } from './tags.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Post.name, schema: PostSchema },
      { name: Comment.name, schema: CommentSchema },
      { name: Like.name, schema: LikeSchema },
    ]),
    UsersModule,
    UploadsModule,
  ],
  controllers: [BlogController, TagsController, CommentsController, CommentItemController, PostImagesController],
  providers: [BlogService, CommentsService, PostImagesService],
  // Comments, likes and search (other BLG tickets) will inject BlogService / the Post model from here.
  exports: [BlogService, MongooseModule],
})
export class BlogModule {}
