import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from '../users/users.module';
import { BlogController } from './blog.controller';
import { BlogService } from './blog.service';
import { Post, PostSchema } from './schemas/post.schema';
import { TagsController } from './tags.controller';

@Module({
  imports: [MongooseModule.forFeature([{ name: Post.name, schema: PostSchema }]), UsersModule],
  controllers: [BlogController, TagsController],
  providers: [BlogService],
  // Comments, likes and search (other BLG tickets) will inject BlogService / the Post model from here.
  exports: [BlogService, MongooseModule],
})
export class BlogModule {}
