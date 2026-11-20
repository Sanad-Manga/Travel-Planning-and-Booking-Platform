import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Comment, CommentSchema } from '../blog/schemas/comment.schema';
import { Post, PostSchema } from '../blog/schemas/post.schema';
import {
  HotelReview,
  HotelReviewSchema,
} from '../hotels/schemas/hotel-review.schema';
import {
  Itinerary,
  ItinerarySchema,
} from '../itineraries/schemas/itinerary.schema';
import { ContentLookupService } from './content-lookup.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { Report, ReportSchema } from './schemas/report.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Report.name, schema: ReportSchema },
      // Read-only lookups of other modules' content (see ContentLookupService); nothing is written to them.
      { name: Post.name, schema: PostSchema },
      { name: Itinerary.name, schema: ItinerarySchema },
      { name: Comment.name, schema: CommentSchema },
      { name: HotelReview.name, schema: HotelReviewSchema },
    ]),
  ],
  controllers: [ReportsController],
  providers: [ReportsService, ContentLookupService],
  // GEN-10 (admin listing and hide/dismiss/delete) builds on the same model and service.
  exports: [ReportsService, MongooseModule],
})
export class ReportsModule {}
