import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Itinerary, ItinerarySchema } from '../itineraries/schemas/itinerary.schema';
import { UsersModule } from '../users/users.module';
import { UploadsModule } from '../uploads';
import { AuthorsController } from './authors.controller';
import { AuthorsService } from './authors.service';
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
      // BLG-12: read only, for the author page's public itineraries. Blog never writes to this collection.
      { name: Itinerary.name, schema: ItinerarySchema },
    ]),
    UsersModule,
    UploadsModule,
  ],
  controllers: [BlogController, TagsController, CommentsController, CommentItemController, PostImagesController, AuthorsController],
  providers: [BlogService, CommentsService, PostImagesService, AuthorsService],
  // Comments, likes and search (other BLG tickets) will inject BlogService / the Post model from here.
  exports: [BlogService, MongooseModule],
})
export class BlogModule {}
