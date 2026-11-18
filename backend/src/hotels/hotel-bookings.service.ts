import { randomBytes } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import {
  AuthenticatedUser,
  BookingStatus,
  BookingType,
  HOLD_MINUTES,
  isCalendarDate,
  NotificationType,
  PLATFORM_CURRENCY,
  Role,
} from '../common';
import { NotificationsService } from '../notifications';
import { BookingPolicies, BookingProvider, BookingStatusSnapshot } from '../payments/booking-provider.interface';
import { BookingProviderRegistry } from '../payments/booking-provider.registry';
import { UpcomingBookingsChecker, UpcomingBookingsRegistry } from '../users/upcoming-bookings';
import { CreateHotelBookingDto } from './dto/create-hotel-booking.dto';
import { HotelBookingResponseDto } from './dto/hotel-booking-response.dto';
import { coversStay, nightsBetween, rangeOverlaps, stayTotalCents, todayUtc } from './hotel-availability.rules';
import { HotelsService } from './hotels.service';
import { RoomReservations } from './room-reservations';
import { Hotel } from './schemas/hotel.schema';
import { HotelBooking, HotelBookingLean } from './schemas/hotel-booking.schema';
import { Room } from './schemas/room.schema';

type SelectedRoom = Room & { _id: Types.ObjectId; __v?: number };

interface FieldError {
  field: string;
  message: string;
}

@Injectable()
export class HotelBookingsService implements RoomReservations, BookingProvider, UpcomingBookingsChecker, OnModuleInit {
  constructor(
    @InjectModel(HotelBooking.name) private readonly bookings: Model<HotelBooking>,
    @InjectModel(Hotel.name) private readonly hotels: Model<Hotel>,
    @InjectModel(Room.name) private readonly rooms: Model<Room>,
    @InjectConnection() private readonly connection: Connection,
    private readonly bookingProviders: BookingProviderRegistry,
    private readonly upcomingBookings: UpcomingBookingsRegistry,
    private readonly notifications: NotificationsService,
    private readonly hotelsService: HotelsService,
  ) {}

  onModuleInit(): void {
    this.bookingProviders.register(BookingType.HOTEL, this);
    this.upcomingBookings.register(BookingType.HOTEL, this);
  }

  async create(
    user: AuthenticatedUser,
    dto: CreateHotelBookingDto,
    now: Date = new Date(),
  ): Promise<HotelBookingResponseDto> {
    if (user.role !== Role.USER) {
      throw new ForbiddenException('Only a registered traveler can create a hotel reservation');
    }
    this.assertRequest(dto, now);

    const roomIds = dto.rooms.map((item) => new Types.ObjectId(item.roomId));
    const nights = nightsBetween(dto.checkIn, dto.checkOut);
    const holdExpiresAt = new Date(now.getTime() + HOLD_MINUTES * 60_000);

    const booking = await this.connection.transaction(async (session) => {
      const selectedRooms = await this.rooms
        // HTL-06: a room whose blocked range overlaps the stay is treated like an inactive one (409 below).
        .find({
          _id: { $in: roomIds },
          isActive: true,
          blockedRanges: { $not: { $elemMatch: rangeOverlaps(dto.checkIn, dto.checkOut) } },
        })
        .select('hotelId name type maxOccupancy pricePerNightCents availability')
        .session(session)
        .lean<SelectedRoom[]>()
        .exec();
      if (selectedRooms.length !== roomIds.length) {
        throw new ConflictException('One or more selected rooms are no longer available');
      }

      const hotelId = selectedRooms[0].hotelId;
      if (selectedRooms.some((room) => !room.hotelId.equals(hotelId))) {
        throw this.inputError('rooms', 'all selected rooms must belong to the same hotel');
      }

      const activeHotel = await this.hotels.exists({ _id: hotelId, isActive: true }).session(session);
      if (!activeHotel) throw new NotFoundException('Hotel not found');

      const roomById = new Map(selectedRooms.map((room) => [room._id.toString(), room]));
      const stayRooms = dto.rooms.map((assignment) => {
        const room = roomById.get(assignment.roomId);
        if (!room || !coversStay(room.availability ?? [], dto.checkIn, dto.checkOut)) {
          throw new ConflictException('One or more selected rooms are not available for the full stay');
        }
        if (assignment.adults + assignment.children > room.maxOccupancy) {
          throw this.inputError(`rooms.${assignment.roomId}`, `guest count exceeds this room's maximum occupancy of ${room.maxOccupancy}`);
        }
        return { assignment, room };
      });

      await this.serializeRoomUpdates(stayRooms.map(({ room }) => room._id), session);

      const reserved = await this.reservedRoomIds(roomIds, dto.checkIn, dto.checkOut, now, session);
      if (roomIds.some((roomId) => reserved.has(roomId.toString()))) {
        throw new ConflictException('One or more selected rooms are already reserved or held for these dates');
      }

      const bookingRooms = stayRooms.map(({ assignment, room }) => ({
        roomId: room._id,
        adults: assignment.adults,
        children: assignment.children,
        name: room.name,
        type: room.type,
        maxOccupancy: room.maxOccupancy,
        pricePerNightCents: room.pricePerNightCents,
        totalCents: stayTotalCents(room.pricePerNightCents, nights),
      }));
      const totalCents = bookingRooms.reduce((sum, room) => sum + room.totalCents, 0);
      if (!Number.isSafeInteger(totalCents)) {
        throw this.inputError('rooms', 'the reservation total exceeds the supported amount');
      }

      const [created] = await this.bookings.create(
        [
          {
            userId: new Types.ObjectId(user.userId),
            hotelId,
            checkIn: dto.checkIn,
            checkOut: dto.checkOut,
            nights,
            rooms: bookingRooms,
            totalCents,
            currency: PLATFORM_CURRENCY,
            status: BookingStatus.PENDING_PAYMENT,
            holdExpiresAt,
          },
        ],
        { session },
      );
      return created;
    });

    return HotelBookingResponseDto.from(booking);
  }

  /** RoomReservations: one query for all rooms that overlap a confirmed stay or a live hold. */
  findReservedRoomIds(roomIds: string[], startDate: string, endDate: string, session?: ClientSession): Promise<Set<string>> {
    const ids = roomIds.filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id));
    if (ids.length === 0) return Promise.resolve(new Set());
    return this.reservedRoomIds(ids, startDate, endDate, new Date(), session);
  }

  /** HTL-06 (deleting a room): any reservation record that mentions the room, whatever its status. */
  async hasAnyReservation(roomId: string, session?: ClientSession): Promise<boolean> {
    if (!Types.ObjectId.isValid(roomId)) return false;
    const query = this.bookings.exists({ 'rooms.roomId': new Types.ObjectId(roomId) });
    if (session) query.session(session);
    return (await query) !== null;
  }

  async hasConfirmedReservation(roomId: string, startDate: string, endDate: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(roomId)) return false;
    const exists = await this.bookings.exists({
      'rooms.roomId': new Types.ObjectId(roomId),
      status: BookingStatus.CONFIRMED,
      checkIn: { $lt: endDate },
      checkOut: { $gt: startDate },
    });
    return exists !== null;
  }

  /** PAY-01: expose the stored reservation total through the documented payable shape. */
  async getPayable(
    id: string,
    userId: string,
  ): Promise<{ amountCents: number; currency: string; status: BookingStatus; holdExpiresAt: Date | null } | null> {
    if (!Types.ObjectId.isValid(id) || !Types.ObjectId.isValid(userId)) return null;
    const booking = await this.bookings
      .findOne({ _id: new Types.ObjectId(id), userId: new Types.ObjectId(userId) })
      .select('totalCents currency status holdExpiresAt')
      .lean<Pick<HotelBookingLean, 'totalCents' | 'currency' | 'status' | 'holdExpiresAt'>>()
      .exec();
    if (!booking) return null;
    return {
      amountCents: booking.totalCents,
      currency: booking.currency,
      status: booking.status,
      holdExpiresAt: booking.holdExpiresAt ?? null,
    };
  }

  async getStatus(id: string): Promise<BookingStatusSnapshot | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    const booking = await this.bookings.findById(id).select('status holdExpiresAt').lean().exec();
    if (!booking) return null;
    return { status: booking.status, holdExpiresAt: booking.holdExpiresAt ?? null };
  }

  /** The reservation status is the inventory claim; changing it releases the rooms in this same transaction. */
  async applyStatus(id: string, from: BookingStatus, to: BookingStatus): Promise<boolean> {
    if (!Types.ObjectId.isValid(id)) return false;
    let applied = false;
    await this.connection.transaction(async (session) => {
      applied = false;
      const before = await this.bookings
        .findOneAndUpdate(
          { _id: new Types.ObjectId(id), status: from },
          { $set: { status: to }, $unset: { holdExpiresAt: '' } },
          { session },
        )
        .select('_id')
        .lean()
        .exec();
      applied = before !== null;
    });
    return applied;
  }

  /** Idempotent payment confirmation, also used by BookingLifecycle's late-paid expiry path. */
  async markConfirmed(id: string, paymentRef: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(id)) return false;

    let outcome: { kind: 'CONFIRMED_NOW' | 'ALREADY' | 'REFUSED'; booking?: HotelBookingLean } = { kind: 'REFUSED' };
    await this.connection.transaction(async (session) => {
      outcome = { kind: 'REFUSED' };
      const before = await this.bookings
        .findOneAndUpdate(
          { _id: new Types.ObjectId(id), status: BookingStatus.PENDING_PAYMENT },
          {
            $set: {
              status: BookingStatus.CONFIRMED,
              paymentRef,
              bookingReference: `HTL-${randomBytes(8).toString('hex').toUpperCase()}`,
            },
            $unset: { holdExpiresAt: '' },
          },
          { session },
        )
        .lean<HotelBookingLean>()
        .exec();
      if (before) {
        outcome = { kind: 'CONFIRMED_NOW', booking: before };
        return;
      }

      const existing = await this.bookings
        .findById(id)
        .session(session)
        .select('status paymentRef')
        .lean<Pick<HotelBookingLean, 'status' | 'paymentRef'>>()
        .exec();
      if (existing?.status === BookingStatus.CONFIRMED && existing.paymentRef === paymentRef) {
        outcome = { kind: 'ALREADY' };
      }
    });

    if (outcome.kind === 'CONFIRMED_NOW' && outcome.booking) {
      await this.notifications.notify({
        userId: outcome.booking.userId.toString(),
        type: NotificationType.BOOKING_CONFIRMED,
        title: 'Hotel reservation confirmed',
        message: 'Your payment was received and your hotel reservation is confirmed.',
      });
    }
    return outcome.kind !== 'REFUSED';
  }

  async getForUser(id: string, userId: string): Promise<HotelBookingResponseDto | null> {
    if (!Types.ObjectId.isValid(id) || !Types.ObjectId.isValid(userId)) return null;
    const booking = await this.bookings
      .findOne({ _id: new Types.ObjectId(id), userId: new Types.ObjectId(userId) })
      .lean<HotelBookingLean>()
      .exec();
    return booking ? HotelBookingResponseDto.from(booking) : null;
  }

  async getPolicies(id: string): Promise<BookingPolicies | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    const booking = await this.bookings
      .findById(id)
      .select('userId hotelId')
      .lean<Pick<HotelBookingLean, 'userId' | 'hotelId'>>()
      .exec();
    if (!booking) return null;

    const policies = await this.hotelsService.getPolicies(booking.hotelId.toString());
    return {
      ownerId: booking.userId.toString(),
      cancellationTiers: policies.cancellationTiers,
      checkInTime: policies.checkInTime,
      checkOutTime: policies.checkOutTime,
    };
  }

  async findExpiredHolds(now: Date, limit: number, afterId?: string): Promise<string[]> {
    if (afterId !== undefined && !Types.ObjectId.isValid(afterId)) return [];
    const rows = await this.bookings
      .find({
        status: BookingStatus.PENDING_PAYMENT,
        holdExpiresAt: { $lte: now },
        ...(afterId ? { _id: { $gt: new Types.ObjectId(afterId) } } : {}),
      })
      .sort({ _id: 1 })
      .limit(limit)
      .select('_id')
      .lean<{ _id: Types.ObjectId }[]>()
      .exec();
    return rows.map((row) => row._id.toString());
  }

  /** ACC-12: only confirmed stays whose UTC check-in date is today or later block deactivation. */
  async hasUpcomingConfirmedBookings(userId: string, now: Date): Promise<boolean> {
    if (!Types.ObjectId.isValid(userId)) return false;
    const exists = await this.bookings.exists({
      userId: new Types.ObjectId(userId),
      status: BookingStatus.CONFIRMED,
      checkIn: { $gte: todayUtc(now) },
    });
    return exists !== null;
  }

  private assertRequest(dto: CreateHotelBookingDto, now: Date): void {
    const details: FieldError[] = [];
    if (!isCalendarDate(dto.checkIn)) details.push({ field: 'checkIn', message: 'checkIn must be a valid calendar date' });
    if (!isCalendarDate(dto.checkOut)) details.push({ field: 'checkOut', message: 'checkOut must be a valid calendar date' });
    if (dto.checkOut <= dto.checkIn) details.push({ field: 'checkOut', message: 'checkOut must be after checkIn' });
    if (isCalendarDate(dto.checkIn) && dto.checkIn < todayUtc(now)) {
      details.push({ field: 'checkIn', message: 'checkIn cannot be in the past' });
    }
    if (dto.rooms.reduce((sum, room) => sum + room.adults, 0) < 1) {
      details.push({ field: 'rooms', message: 'at least one adult is required for the reservation' });
    }
    if (details.length > 0) throw new BadRequestException({ message: 'Validation failed', details });
  }

  private async reservedRoomIds(
    roomIds: Types.ObjectId[],
    startDate: string,
    endDate: string,
    now: Date,
    session?: ClientSession,
  ): Promise<Set<string>> {
    const query = this.bookings
      .find({
        'rooms.roomId': { $in: roomIds },
        checkIn: { $lt: endDate },
        checkOut: { $gt: startDate },
        $or: [
          { status: BookingStatus.CONFIRMED },
          { status: BookingStatus.PENDING_PAYMENT, holdExpiresAt: { $gt: now } },
        ],
      })
      .select('rooms.roomId');
    if (session) query.session(session);
    const rows = await query.lean<Pick<HotelBookingLean, 'rooms'>[]>().exec();
    return new Set(rows.flatMap((booking) => booking.rooms.map((room) => room.roomId.toString())));
  }

  /**
   * A transaction that only reads reservations could allow two simultaneous inserts for the same room.
   * Incrementing Mongoose's built-in version key makes transactions contend on each selected room document;
   * a retried transaction then observes the committed reservation before it creates another hold.
   */
  private async serializeRoomUpdates(roomIds: Types.ObjectId[], session: ClientSession): Promise<void> {
    // This uses the room version key to serialize competing holds; enabling optimistic concurrency on Room would also affect room edits.
    for (const roomId of [...roomIds].sort((a, b) => a.toString().localeCompare(b.toString()))) {
      const result = await this.rooms.updateOne({ _id: roomId }, { $inc: { __v: 1 } }, { session }).exec();
      if (result.matchedCount !== 1) {
        throw new ConflictException('One or more selected rooms are no longer available');
      }
    }
  }

  private inputError(field: string, message: string): BadRequestException {
    return new BadRequestException({ message: 'Validation failed', details: [{ field, message }] });
  }
}
