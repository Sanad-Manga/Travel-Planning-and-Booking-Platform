import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import {
  AccountStatus,
  AuthenticatedUser,
  BookingStatus,
  Role,
} from '../common';
import { UsersService } from '../users/users.service';
import { CreateHotelReviewDto } from './dto/create-hotel-review.dto';
import { HotelReviewItemDto } from './dto/hotel-details-response.dto';
import { UpdateHotelReviewDto } from './dto/update-hotel-review.dto';
import { HotelBookingsService } from './hotel-bookings.service';
import {
  HOTEL_REVIEW_MAX_LENGTH,
  HOTEL_REVIEW_MAX_RATING,
  HOTEL_REVIEW_MIN_RATING,
} from './hotels.constants';
import { Hotel } from './schemas/hotel.schema';
import { HotelReview, HotelReviewLean } from './schemas/hotel-review.schema';
import { todayUtc } from './hotel-availability.rules';

interface RatingSummary {
  _id: null;
  averageRating: number;
  reviewCount: number;
}

interface HotelReviewAggregation {
  summary: RatingSummary[];
  reviews: Array<{
    _id: Types.ObjectId;
    rating: number;
    comment: string;
    authorName: string;
    createdAt: Date;
  }>;
}

export interface HotelReviewSummary {
  averageRating: number | null;
  reviewCount: number;
  reviews: HotelReviewItemDto[];
}

function isDuplicateKeyError(error: unknown): error is { code: 11000 } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 11000
  );
}

@Injectable()
export class HotelReviewsService {
  constructor(
    @InjectModel(HotelReview.name) private readonly reviews: Model<HotelReview>,
    @InjectModel(Hotel.name) private readonly hotels: Model<Hotel>,
    @InjectConnection() private readonly connection: Connection,
    private readonly bookings: HotelBookingsService,
    private readonly users: UsersService,
  ) {}

  async createForBooking(
    bookingId: string,
    actor: AuthenticatedUser,
    dto: CreateHotelReviewDto,
    now: Date = new Date(),
  ): Promise<HotelReviewItemDto> {
    this.assertTraveler(actor);
    this.assertReviewInput(dto.rating, dto.comment);
    const booking = await this.bookings.getForUser(
      bookingId,
      actor.userId,
      now,
    );
    if (!booking) throw new NotFoundException('Hotel booking not found');
    this.assertCompletedStay(booking, now);

    const bookingObjectId = new Types.ObjectId(booking.id);
    const hotelObjectId = new Types.ObjectId(booking.hotelId);
    const authorName = await this.authorName(actor.userId);

    try {
      const review = await this.connection.transaction(async (session) => {
        const existing = await this.reviews
          .findOne({ bookingId: bookingObjectId })
          .select('_id')
          .session(session)
          .lean()
          .exec();
        if (existing) {
          throw new ConflictException(
            'A review already exists for this reservation',
          );
        }

        const [created] = await this.reviews.create(
          [
            {
              bookingId: bookingObjectId,
              hotelId: hotelObjectId,
              authorId: new Types.ObjectId(actor.userId),
              rating: dto.rating,
              comment: dto.comment?.trim() ?? '',
              isHidden: false,
            },
          ],
          { session },
        );
        await this.recalculateHotelRating(hotelObjectId, session);
        return created;
      });

      return this.toItem(review, authorName);
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new ConflictException(
          'A review already exists for this reservation',
        );
      }
      throw error;
    }
  }

  async update(
    id: string,
    actor: AuthenticatedUser,
    dto: UpdateHotelReviewDto,
  ): Promise<HotelReviewItemDto> {
    this.assertTraveler(actor);
    const reviewId = this.parseReviewId(id);
    if (dto.rating === undefined && dto.comment === undefined) {
      throw new BadRequestException({
        message: 'Validation failed',
        details: [
          { field: 'body', message: 'Send at least one field to update' },
        ],
      });
    }
    if (dto.rating !== undefined) this.assertReviewInput(dto.rating);
    if (dto.comment !== undefined)
      this.assertReviewInput(undefined, dto.comment);

    const changes: Partial<Pick<HotelReview, 'rating' | 'comment'>> = {};
    if (dto.rating !== undefined) changes.rating = dto.rating;
    if (dto.comment !== undefined) changes.comment = dto.comment.trim();

    const review = await this.connection.transaction(async (session) => {
      const current = await this.reviews
        .findById(reviewId)
        .session(session)
        .lean<HotelReviewLean>()
        .exec();
      if (!current) throw new NotFoundException('Review not found');
      if (!current.authorId.equals(new Types.ObjectId(actor.userId))) {
        throw new NotFoundException('Review not found');
      }

      const updated = await this.reviews
        .findOneAndUpdate(
          { _id: reviewId, authorId: new Types.ObjectId(actor.userId) },
          { $set: changes },
          { new: true, runValidators: true, session },
        )
        .lean<HotelReviewLean>()
        .exec();
      if (!updated)
        throw new ConflictException('Review changed while updating');

      await this.recalculateHotelRating(current.hotelId, session);
      return updated;
    });

    return this.toItem(review, await this.authorName(actor.userId));
  }

  async delete(id: string, actor: AuthenticatedUser): Promise<void> {
    this.assertTraveler(actor);
    const reviewId = this.parseReviewId(id);

    await this.connection.transaction(async (session) => {
      const current = await this.reviews
        .findById(reviewId)
        .session(session)
        .lean<HotelReviewLean>()
        .exec();
      if (!current) throw new NotFoundException('Review not found');
      if (!current.authorId.equals(new Types.ObjectId(actor.userId))) {
        throw new NotFoundException('Review not found');
      }

      const result = await this.reviews
        .deleteOne({
          _id: reviewId,
          authorId: new Types.ObjectId(actor.userId),
        })
        .session(session)
        .exec();
      if (result.deletedCount !== 1) {
        throw new ConflictException('Review changed while deleting');
      }
      await this.recalculateHotelRating(current.hotelId, session);
    });
  }

  async getSummary(hotelId: string): Promise<HotelReviewSummary> {
    if (!Types.ObjectId.isValid(hotelId))
      throw new NotFoundException('Hotel not found');
    const [result] = await this.reviews
      .aggregate<HotelReviewAggregation>([
        {
          $match: {
            hotelId: new Types.ObjectId(hotelId),
            isHidden: { $ne: true },
          },
        },
        {
          $facet: {
            summary: [
              {
                $group: {
                  _id: null,
                  averageRating: { $avg: '$rating' },
                  reviewCount: { $sum: 1 },
                },
              },
            ],
            reviews: [
              { $sort: { createdAt: -1, _id: -1 } },
              {
                $lookup: {
                  from: 'users',
                  localField: 'authorId',
                  foreignField: '_id',
                  as: 'author',
                },
              },
              {
                $unwind: { path: '$author', preserveNullAndEmptyArrays: true },
              },
              {
                $project: {
                  _id: 1,
                  rating: 1,
                  comment: { $ifNull: ['$comment', ''] },
                  authorName: {
                    $cond: [
                      { $eq: ['$author.status', AccountStatus.DEACTIVATED] },
                      'Deleted user',
                      { $ifNull: ['$author.name', 'Deleted user'] },
                    ],
                  },
                  createdAt: 1,
                },
              },
            ],
          },
        },
      ])
      .exec();

    const summary = result?.summary[0];
    return {
      averageRating: summary?.averageRating ?? null,
      reviewCount: summary?.reviewCount ?? 0,
      reviews: (result?.reviews ?? []).map((review) => ({
        id: review._id.toString(),
        rating: review.rating,
        comment: review.comment,
        authorName: review.authorName,
        createdAt: review.createdAt.toISOString(),
      })),
    };
  }

  private async recalculateHotelRating(
    hotelId: Types.ObjectId,
    session: ClientSession,
  ): Promise<void> {
    const [summary] = await this.reviews
      .aggregate<RatingSummary>([
        { $match: { hotelId, isHidden: { $ne: true } } },
        {
          $group: {
            _id: null,
            averageRating: { $avg: '$rating' },
            reviewCount: { $sum: 1 },
          },
        },
      ])
      .session(session)
      .exec();

    const result = await this.hotels
      .updateOne(
        { _id: hotelId },
        {
          $set: {
            averageRating: summary?.averageRating ?? null,
            reviewCount: summary?.reviewCount ?? 0,
          },
        },
        { session },
      )
      .exec();
    if (result.matchedCount !== 1)
      throw new NotFoundException('Hotel not found');
  }

  private async authorName(userId: string): Promise<string> {
    const author = await this.users.findById(userId);
    return !author || author.status === AccountStatus.DEACTIVATED
      ? 'Deleted user'
      : author.name;
  }

  private assertTraveler(actor: AuthenticatedUser): void {
    if (actor.role !== Role.USER) {
      throw new ForbiddenException('Only a traveler can manage hotel reviews');
    }
  }

  private assertReviewInput(rating?: number, comment?: string | null): void {
    const details: Array<{ field: string; message: string }> = [];
    if (
      rating !== undefined &&
      (!Number.isInteger(rating) ||
        rating < HOTEL_REVIEW_MIN_RATING ||
        rating > HOTEL_REVIEW_MAX_RATING)
    ) {
      details.push({
        field: 'rating',
        message: `rating must be an integer between ${HOTEL_REVIEW_MIN_RATING} and ${HOTEL_REVIEW_MAX_RATING}`,
      });
    }
    if (
      comment !== undefined &&
      comment !== null &&
      comment.trim().length > HOTEL_REVIEW_MAX_LENGTH
    ) {
      details.push({
        field: 'comment',
        message: `comment must be at most ${HOTEL_REVIEW_MAX_LENGTH} characters`,
      });
    }
    if (details.length > 0)
      throw new BadRequestException({ message: 'Validation failed', details });
  }

  private assertCompletedStay(
    booking: { status: BookingStatus; checkOut: string },
    now: Date,
  ): void {
    if (
      booking.status !== BookingStatus.COMPLETED ||
      booking.checkOut >= todayUtc(now)
    ) {
      throw new ConflictException(
        'A review can only be submitted after a completed stay',
      );
    }
  }

  private parseReviewId(id: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(id))
      throw new NotFoundException('Review not found');
    return new Types.ObjectId(id);
  }

  private toItem(
    review: HotelReviewLean,
    authorName: string,
  ): HotelReviewItemDto {
    return {
      id: review._id.toString(),
      rating: review.rating,
      comment: review.comment ?? '',
      authorName,
      createdAt: review.createdAt.toISOString(),
    };
  }
}
