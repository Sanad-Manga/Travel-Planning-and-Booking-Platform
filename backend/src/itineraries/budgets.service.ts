import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuthenticatedUser, PLATFORM_CURRENCY } from '../common';
import { FxService } from '../fx';
import { ReferenceDataService } from '../reference-data/reference-data.service';
import { UsersService } from '../users/users.service';
import { ActivitiesService } from './activities.service';
import { BudgetDto, toBudgetDto } from './dto/budget.dto';
import {
  buildBudgetSummary,
  BudgetSummaryDto,
  ConvertedBudgetTotalDto,
  LinkedBookingCost,
} from './dto/budget-summary.dto';
import { CreateBudgetDto } from './dto/create-budget.dto';
import { toItineraryDay } from './dto/itinerary-day.dto';
import { ItineraryBookingsService } from './itinerary-bookings.service';
import { UpdateBudgetDto } from './dto/update-budget.dto';
import { Budget, BudgetLean } from './schemas/budget.schema';
import { Itinerary, ItineraryLean } from './schemas/itinerary.schema';
import { TransportCostsService } from './transport-costs.service';

/**
 * ITN-14: the daily budget entries of an itinerary and the summary of everything that costs money on it. Every write
 * is ONE query whose filter holds the caller as owner (404 for someone else's, the same as a missing one).
 */
@Injectable()
export class BudgetsService {
  constructor(
    @InjectModel(Budget.name) private readonly model: Model<Budget>,
    @InjectModel(Itinerary.name)
    private readonly itineraries: Model<Itinerary>,
    private readonly referenceData: ReferenceDataService,
    private readonly activities: ActivitiesService,
    private readonly transportCosts: TransportCostsService,
    private readonly fx: FxService,
    private readonly users: UsersService,
    private readonly bookingLinks: ItineraryBookingsService,
  ) {}

  /**
   * The owner adds an entry to one of the days of their itinerary. The itinerary id, the owner and the day id must
   * all match one itinerary, or the answer is 404; then the currency is checked (400). The itinerary, the day and
   * the owner come from the URL and the login, never from the body.
   */
  async create(
    user: AuthenticatedUser,
    itineraryId: string,
    dayId: string,
    dto: CreateBudgetDto,
  ): Promise<BudgetDto> {
    const ownerId = new Types.ObjectId(user.userId);
    const dayObjectId = new Types.ObjectId(dayId);
    const hasDay = await this.itineraries.exists({
      _id: itineraryId,
      authorId: ownerId,
      'days._id': dayObjectId,
    });
    if (!hasDay) throw new NotFoundException('Itinerary or day not found');

    const currency = dto.currency ?? PLATFORM_CURRENCY;
    if (dto.currency !== undefined) await this.assertCurrency(currency);

    const created = await this.model.create({
      itineraryId: new Types.ObjectId(itineraryId),
      dayId: dayObjectId,
      ownerId,
      category: dto.category,
      amountCents: dto.amountCents,
      currency,
    });
    return toBudgetDto(created.toObject<BudgetLean>());
  }

  /**
   * The owner edits an entry: category, amount and/or currency. The currency is checked first (400); then ONE
   * update whose filter holds the id AND the owner writes the change. Someone else's entry or an unknown id
   * matches nothing and answers 404.
   */
  async update(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateBudgetDto,
  ): Promise<BudgetDto> {
    const changes = Object.fromEntries(
      Object.entries(dto).filter(([, value]) => value !== undefined),
    ) as Partial<UpdateBudgetDto>;
    if (Object.keys(changes).length === 0) {
      throw new BadRequestException({
        message: 'Nothing to update',
        details: [
          {
            field: 'body',
            message: 'send at least one of category, amountCents, currency',
          },
        ],
      });
    }
    if (changes.currency !== undefined) {
      await this.assertCurrency(changes.currency);
    }

    const updated = await this.model
      .findOneAndUpdate(
        { _id: id, ownerId: new Types.ObjectId(user.userId) },
        { $set: changes },
        { new: true, runValidators: true },
      )
      .lean<BudgetLean>()
      .exec();
    if (!updated) throw new NotFoundException('Budget entry not found');
    return toBudgetDto(updated);
  }

  /** The owner deletes an entry. Someone else's, an unknown one and one already deleted all answer 404. */
  async remove(user: AuthenticatedUser, id: string): Promise<void> {
    const result = await this.model
      .deleteOne({ _id: id, ownerId: new Types.ObjectId(user.userId) })
      .exec();
    if (result.deletedCount === 0) {
      throw new NotFoundException('Budget entry not found');
    }
  }

  /**
   * The owner's budget summary: the total of everything that costs money on the itinerary, by category and by day,
   * per currency. Someone else's or an unknown itinerary answers 404.
   *
   * ITN-18: also attaches `convertedTotal`, the grand total converted into `currency` (validated if given) or
   * the caller's preferred currency (ACC-09) otherwise, falling back to the platform currency as a last resort.
   */
  async summary(
    user: AuthenticatedUser,
    itineraryId: string,
    currency?: string,
  ): Promise<BudgetSummaryDto> {
    const itinerary = await this.itineraries
      .findOne({
        _id: itineraryId,
        authorId: new Types.ObjectId(user.userId),
      })
      .lean<ItineraryLean>()
      .exec();
    if (!itinerary) throw new NotFoundException('Itinerary not found');
    const summary = await this.summaryOf(itinerary);

    if (currency !== undefined) await this.assertCurrency(currency);
    const target =
      currency ??
      (await this.users.findById(user.userId))?.preferredCurrency ??
      PLATFORM_CURRENCY;
    summary.convertedTotal = await this.convertGrandTotal(summary, target);
    return summary;
  }

  /** The summary of an itinerary the caller may already read (own, or public for the read-only view). */
  async summaryOf(itinerary: ItineraryLean): Promise<BudgetSummaryDto> {
    const [activities, transportCosts, budgets, linkedBookings] =
      await Promise.all([
        this.activities.listByItinerary(itinerary._id),
        this.transportCosts.listByItinerary(itinerary._id),
        this.listByItinerary(itinerary._id),
        this.linkedBookingCosts(itinerary._id),
      ]);
    const days = (itinerary.days ?? []).map((day, index) =>
      toItineraryDay(day, index, itinerary.startDate),
    );
    return buildBudgetSummary(
      itinerary._id.toString(),
      days,
      activities,
      transportCosts,
      budgets,
      linkedBookings,
    );
  }

  /**
   * ITN-27: what the bookings linked to the itinerary's days add to its budget. Only the owner's own views use it (the
   * summary and the city-group subtotals): a booking is private to its owner, so the public view and a clone leave it out.
   */
  linkedBookingCosts(
    itineraryId: Types.ObjectId,
  ): Promise<LinkedBookingCost[]> {
    return this.bookingLinks.costsOf(itineraryId);
  }

  /** All entries of an itinerary, oldest first, for showing them on the itinerary. Does not check ownership. */
  async listByItinerary(itineraryId: Types.ObjectId): Promise<BudgetDto[]> {
    const rows = await this.model
      .find({ itineraryId })
      .sort({ _id: 1 })
      .lean<BudgetLean[]>()
      .exec();
    return rows.map(toBudgetDto);
  }

  /**
   * ITN-21: copies the entries of a public itinerary into its clone, onto the matching new day (`dayIds` maps each day
   * of the original to its copy). An entry of a day that is not in the map is skipped. The copy belongs to `ownerId`.
   */
  async copyForClone(
    fromItineraryId: Types.ObjectId,
    toItineraryId: Types.ObjectId,
    ownerId: Types.ObjectId,
    dayIds: Map<string, Types.ObjectId>,
  ): Promise<void> {
    const rows = await this.model
      .find({ itineraryId: fromItineraryId })
      .sort({ _id: 1 })
      .lean<BudgetLean[]>()
      .exec();
    const copies = rows.flatMap((row) => {
      const dayId = dayIds.get(row.dayId.toString());
      if (!dayId) return [];
      return [
        {
          itineraryId: toItineraryId,
          dayId,
          ownerId,
          category: row.category,
          amountCents: row.amountCents,
          currency: row.currency,
        },
      ];
    });
    if (copies.length > 0) await this.model.insertMany(copies);
  }

  /** Called when an itinerary is deleted: its entries go with it. */
  async removeForItinerary(itineraryId: Types.ObjectId): Promise<void> {
    await this.model.deleteMany({ itineraryId }).exec();
    // ITN-27: the bookings linked to its days go with it.
    await this.bookingLinks.removeForItinerary(itineraryId);
  }

  /** Called when one day is deleted (ITN-07): the entries of that day go with it, the other days keep theirs. */
  async removeForDay(
    itineraryId: Types.ObjectId,
    dayId: Types.ObjectId,
  ): Promise<void> {
    await this.model.deleteMany({ itineraryId, dayId }).exec();
    // ITN-27: the bookings linked to that day go with it.
    await this.bookingLinks.removeForDay(itineraryId, dayId);
  }

  /**
   * ITN-18: converts every currency block's totalCents into `target` and sums them. Skips the FX
   * call entirely for a block already in `target`. `rateDate` is the oldest among the conversions
   * actually used, so a partially-stale cache is reported honestly rather than arbitrarily.
   */
  private async convertGrandTotal(
    summary: BudgetSummaryDto,
    target: string,
  ): Promise<ConvertedBudgetTotalDto> {
    let totalCents = 0;
    let rateDate: string | null = null;
    for (const block of summary.totals) {
      if (block.currency === target) {
        totalCents += block.totalCents;
        continue;
      }
      const converted = await this.fx.convert(
        block.totalCents,
        block.currency,
        target,
      );
      totalCents += converted.amount;
      if (rateDate === null || converted.rateDate < rateDate) {
        rateDate = converted.rateDate;
      }
    }
    return {
      currency: target,
      totalCents,
      rateDate: rateDate ?? new Date().toISOString().slice(0, 10),
    };
  }

  /** The currency must be a supported code (GEN-12). */
  private async assertCurrency(currency: string): Promise<void> {
    if (!(await this.referenceData.findCurrencyById(currency))) {
      throw new BadRequestException({
        message: 'Validation failed',
        details: [
          { field: 'currency', message: `unsupported currency: ${currency}` },
        ],
      });
    }
  }
}
