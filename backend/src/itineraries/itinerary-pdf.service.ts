import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuthenticatedUser } from '../common';
import { ReferenceDataService } from '../reference-data/reference-data.service';
import { UsersService } from '../users/users.service';
import { BudgetsService } from './budgets.service';
import { ItineraryDayDto } from './dto/itinerary-day.dto';
import { ItinerariesPublicService } from './itineraries-public.service';
import { ItinerariesService } from './itineraries.service';
import {
  pdfFilename,
  pdfLines,
  renderPdf,
  toPdfData,
} from './itinerary-pdf.document';
import { Itinerary, ItineraryLean } from './schemas/itinerary.schema';

/** ITN-28: the bytes and the attachment name of one exported itinerary. */
export interface ItineraryPdfFile {
  buffer: Buffer;
  filename: string;
}

/**
 * ITN-28: exports an itinerary as a PDF with its days, cities, activities and budget. The PDF is made in memory for
 * each request and never stored. Who may export is the same as who may read: the owner, whatever the visibility (an
 * itinerary that an admin hid is still its author's), and anyone for a public itinerary (shown by the same rules as
 * the public view, ITN-21). The owner's budget is the one of the budget summary (ITN-14, with linked bookings once
 * ITN-27 is in); the public one is the public view's.
 */
@Injectable()
export class ItineraryPdfService {
  constructor(
    @InjectModel(Itinerary.name) private readonly model: Model<Itinerary>,
    private readonly itineraries: ItinerariesService,
    private readonly publicItineraries: ItinerariesPublicService,
    private readonly budgets: BudgetsService,
    private readonly users: UsersService,
    private readonly referenceData: ReferenceDataService,
  ) {}

  /**
   * A logged-in traveler: their own itinerary, else the public itinerary of that id. Someone else's private,
   * hidden, unknown or inactive-author itinerary answers 404, so ids cannot be probed.
   */
  async exportForUser(
    user: AuthenticatedUser,
    id: string,
    now: Date = new Date(),
  ): Promise<ItineraryPdfFile> {
    const own = await this.model
      .findOne({ _id: id, authorId: new Types.ObjectId(user.userId) })
      .lean<ItineraryLean>()
      .exec();
    if (!own) return this.exportPublic(id, now);

    const [full, summary, author] = await Promise.all([
      this.itineraries.withActivities(own),
      this.budgets.summaryOf(own),
      this.users.findById(user.userId),
    ]);
    return this.file(
      {
        title: own.title,
        countryCodes: own.countryCodes,
        startDate: own.startDate,
        authorName: author?.name ?? null,
        days: full.days,
        summary,
      },
      now,
    );
  }

  /** Anyone, a guest too: a public itinerary only (404 for a private, hidden, unknown or inactive-author one). */
  async exportPublic(
    id: string,
    now: Date = new Date(),
  ): Promise<ItineraryPdfFile> {
    const view = await this.publicItineraries.findPublic(id);
    return this.file(
      {
        title: view.title,
        countryCodes: view.countryCodes,
        startDate: view.startDate,
        authorName: view.author.name,
        days: view.days,
        summary: view.budget,
      },
      now,
    );
  }

  private async file(
    source: {
      title: string;
      countryCodes: string[];
      startDate: string;
      authorName: string | null;
      days: ItineraryDayDto[];
      summary: Parameters<typeof toPdfData>[0]['summary'];
    },
    now: Date,
  ): Promise<ItineraryPdfFile> {
    const cityIds = [...new Set(source.days.map((day) => day.cityId))];
    const found = await Promise.all(
      cityIds.map((cityId) => this.referenceData.findCityById(cityId)),
    );
    const cityNames = new Map(
      found.flatMap((city) =>
        city ? [[city.city_id, city.name] as [string, string]] : [],
      ),
    );

    const buffer = await renderPdf(
      pdfLines(toPdfData({ ...source, cityNames, now })),
    );
    return { buffer, filename: pdfFilename(source.title) };
  }
}
