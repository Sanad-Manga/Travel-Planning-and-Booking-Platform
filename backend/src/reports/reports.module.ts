import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Post, PostSchema } from '../blog/schemas/post.schema';
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
    ]),
  ],
  controllers: [ReportsController],
  providers: [ReportsService, ContentLookupService],
  // GEN-10 (admin listing and hide/dismiss/delete) builds on the same model and service.
  exports: [ReportsService, MongooseModule],
})
export class ReportsModule {}
