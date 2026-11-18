import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuthenticatedUser, BookingStatus } from '../common';
import { BookingProviderRegistry } from '../payments';
import { LinkedBookingCost } from './dto/budget-summary.dto';
import {
  ItineraryBookingDto,
  LinkBookingDto,
  summaryCategoryOf,
  toItineraryBookingDto,
} from './dto/link-booking.dto';
import {
  ItineraryBooking,
  ItineraryBookingLean,
} from './schemas/itinerary-booking.schema';
import { Itinerary } from './schemas/itinerary.schema';

/** A linked booking keeps counting in the budget while it is a real booking: confirmed, or finished after the stay or flight. */
const COUNTED_STATUSES: readonly BookingStatus[] = [
  BookingStatus.CONFIRMED,
  BookingStatus.COMPLETED,
];

/**
 * ITN-27: the owner links one of their CONFIRMED flight or hotel bookings to a day of their itinerary, and the linked
 * amount is added to the itinerary's budget. The booking is read through its owner's `BookingProvider` (the shared
 * contract in docs/contracts.md section 7), never from the Flights or Hotels collections.
 */
@Injectable()
export class ItineraryBookingsService {
  constructor(
    @InjectModel(ItineraryBooking.name)
    private readonly model: Model<ItineraryBooking>,
    @InjectModel(Itinerary.name) private readonly itineraries: Model<Itinerary>,
    private readonly providers: BookingProviderRegistry,
  ) {}

  /**
   * The itinerary id, the owner and the day id must match one itinerary, or the answer is 404. The booking must be the
   * caller's own (404 otherwise, the same as an unknown one) and CONFIRMED (409). A booking is linked to an itinerary
   * once: a second link of the same booking is a 409, on any day. The unique index makes that atomic.
   */
  async link(
    user: AuthenticatedUser,
    itineraryId: string,
    dto: LinkBookingDto,
  ): Promise<ItineraryBookingDto> {
    const ownerId = new Types.ObjectId(user.userId);
    const dayId = new Types.ObjectId(dto.dayId);
    const hasDay = await this.itineraries.exists({
      _id: itineraryId,
      authorId: ownerId,
      'days._id': dayId,
    });
    if (!hasDay) throw new NotFoundException('Itinerary or day not found');

    const provider = this.providers.tryGet(dto.bookingType);
    if (!provider?.getPayable)
      throw new ConflictException(
        `${dto.bookingType} bookings cannot be linked`,
      );
    // Owner-scoped: null for an unknown booking and for someone else's alike.
    const booking = await provider.getPayable(dto.bookingId, user.userId);
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.status !== BookingStatus.CONFIRMED) {
      throw new ConflictException(
        `Only a CONFIRMED booking can be linked; this one is ${booking.status}`,
      );
    }

    try {
      const created = await this.model.create({
        itineraryId: new Types.ObjectId(itineraryId),
        dayId,
        ownerId,
        bookingType: dto.bookingType,
        bookingId: new Types.ObjectId(dto.bookingId),
        amountCents: booking.amountCents,
        currency: booking.currency,
      });
      return toItineraryBookingDto(created.toObject<ItineraryBookingLean>());
    } catch (error) {
      if ((error as { code?: number })?.code === 11000) {
        throw new ConflictException(
          'This booking is already linked to this itinerary',
        );
      }
      throw error;
    }
  }

  /**
   * What the linked bookings of an itinerary add to its budget: one cost per link, under ACCOMMODATION (hotel) or
   * INTERCITY_TRANSPORT (flight). A booking that is no longer confirmed or completed (cancelled, say) is left out, so
   * a refunded booking does not stay in the budget. Each link counts once. Does not check ownership.
   */
  async costsOf(itineraryId: Types.ObjectId): Promise<LinkedBookingCost[]> {
    const links = await this.model
      .find({ itineraryId })
      .sort({ _id: 1 })
      .lean<ItineraryBookingLean[]>()
      .exec();
    const counted = await Promise.all(
      links.map(async (row) => {
        const snapshot = await this.providers
          .tryGet(row.bookingType)
          ?.getStatus(row.bookingId.toString());
        return snapshot && COUNTED_STATUSES.includes(snapshot.status)
          ? row
          : null;
      }),
    );
    return counted
      .filter((row): row is ItineraryBookingLean => row !== null)
      .map((row) => ({
        dayId: row.dayId.toString(),
        category: summaryCategoryOf(row.bookingType),
        amountCents: row.amountCents,
        currency: row.currency,
      }));
  }

  /** Called when an itinerary is deleted: its links go with it. */
  async removeForItinerary(itineraryId: Types.ObjectId): Promise<void> {
    await this.model.deleteMany({ itineraryId }).exec();
  }

  /** Called when one day is deleted (ITN-07): the links of that day go with it, the other days keep theirs. */
  async removeForDay(
    itineraryId: Types.ObjectId,
    dayId: Types.ObjectId,
  ): Promise<void> {
    await this.model.deleteMany({ itineraryId, dayId }).exec();
  }
}
