import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from '../users/users.module';
import { BlogController } from './blog.controller';
import { BlogService } from './blog.service';
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
  ],
  controllers: [BlogController, TagsController, CommentsController],
  providers: [BlogService, CommentsService],
  // Comments, likes and search (other BLG tickets) will inject BlogService / the Post model from here.
  exports: [BlogService, MongooseModule],
})
export class BlogModule {}
