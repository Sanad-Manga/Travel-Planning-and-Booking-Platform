import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { Model, PipelineStage, Types } from 'mongoose';
import { Airline } from '../airlines/schemas/airline.schema';
import {
  AuthenticatedUser,
  BookingStatus,
  BookingType,
  flattenValidationErrors,
  RefundStatus,
  Role,
} from '../common';
import { FlightBooking } from '../flights/schemas/flight-booking.schema';
import { HotelBooking } from '../hotels/schemas/hotel-booking.schema';
import { Hotel } from '../hotels/schemas/hotel.schema';
import { Refund } from '../refunds/schemas/refund.schema';
import { AdminAnalyticsQueryDto } from './dto/admin-analytics-query.dto';
import { AdminAnalyticsResponseDto } from './dto/admin-analytics-response.dto';

type GroupStage =
  | PipelineStage.Match
  | PipelineStage.Project
  | PipelineStage.Set
  | PipelineStage.Lookup
  | PipelineStage.Group
  | PipelineStage.Sort;

interface ProviderAggregate {
  type: BookingType;
  providerId: string | null;
  providerName: string | null;
  bookingCount: number;
  confirmedBookingCount: number;
  invalidAmounts: number;
  revenueByCurrency: { currency: string; revenueCents: Types.Decimal128 }[];
}

const ZERO_CENTS = Types.Decimal128.fromString('0');

// Convert via integer BSON long so Decimal128 sums preserve exact minor units.
function checkedCents(field: string) {
  return {
    $let: {
      vars: {
        cents: {
          $convert: { input: field, to: 'long', onError: null, onNull: null },
        },
      },
      in: {
        $cond: [
          {
            $and: [
              { $isNumber: field },
              { $eq: [field, '$$cents'] },
              { $gte: ['$$cents', 0] },
              { $lte: ['$$cents', Number.MAX_SAFE_INTEGER] },
            ],
          },
          { $toDecimal: '$$cents' },
          null,
        ],
      },
    },
  };
}

@Injectable()
export class AdminAnalyticsService {
  constructor(
    @InjectModel(FlightBooking.name)
    private readonly flightBookings: Model<FlightBooking>,
    @InjectModel(HotelBooking.name)
    private readonly hotelBookings: Model<HotelBooking>,
    @InjectModel(Airline.name) private readonly airlines: Model<Airline>,
    @InjectModel(Hotel.name) private readonly hotels: Model<Hotel>,
    @InjectModel(Refund.name) private readonly refunds: Model<Refund>,
  ) {}

  async summarize(
    actor: AuthenticatedUser,
    input: AdminAnalyticsQueryDto,
  ): Promise<AdminAnalyticsResponseDto> {
    if (!actor?.userId)
      throw new UnauthorizedException('Authentication required');
    if (actor.role !== Role.ADMIN)
      throw new ForbiddenException('Administrator role required');

    const query = plainToInstance(AdminAnalyticsQueryDto, input ?? {});
    const details = flattenValidationErrors(
      validateSync(query, { whitelist: true, forbidNonWhitelisted: true }),
    );
    if (details.length)
      throw new BadRequestException({ message: 'Validation failed', details });
    const { dateFrom, dateTo } = query;
    if (dateFrom > dateTo) {
      throw new BadRequestException({
        message: 'Validation failed',
        details: [
          { field: 'dateTo', message: 'dateTo must be on or after dateFrom' },
        ],
      });
    }

    const end = new Date(dateTo);
    end.setUTCDate(end.getUTCDate() + 1);
    const period = { $gte: new Date(dateFrom), $lt: end };

    try {
      const rows = await this.flightBookings
        .aggregate<ProviderAggregate>([
          ...this.groupProviders(
            period,
            BookingType.FLIGHT,
            'airlineId',
            this.airlines.collection.name,
          ),
          {
            $unionWith: {
              coll: this.hotelBookings.collection.name,
              pipeline: this.groupProviders(
                period,
                BookingType.HOTEL,
                'hotelId',
                this.hotels.collection.name,
              ),
            },
          },
          { $sort: { type: 1, providerId: 1 } },
        ])
        .allowDiskUse(true)
        .exec();

      const summary = {
        totalBookings: 0,
        flightBookings: 0,
        hotelBookings: 0,
        confirmedBookings: 0,
      };
      const providers = rows.map((row) => {
        if (!row.providerId || !Types.ObjectId.isValid(row.providerId)) {
          throw new Error('Missing or invalid booking provider identity');
        }
        if (row.invalidAmounts)
          throw new Error('Inconsistent booking or refund amounts');
        const revenueByCurrency = row.revenueByCurrency.map(
          ({ currency, revenueCents }) => {
            const cents = Number(revenueCents.toString());
            if (!Number.isSafeInteger(cents) || cents < 0)
              throw new Error('Revenue exceeds the response integer range');
            return { currency, revenueCents: cents };
          },
        );
        summary.totalBookings += row.bookingCount;
        summary.confirmedBookings += row.confirmedBookingCount;
        if (row.type === BookingType.FLIGHT)
          summary.flightBookings += row.bookingCount;
        else summary.hotelBookings += row.bookingCount;

        return {
          type: row.type,
          providerId: row.providerId,
          providerName: row.providerName,
          bookingCount: row.bookingCount,
          confirmedBookingCount: row.confirmedBookingCount,
          revenueByCurrency,
        };
      });
      return { period: { dateFrom, dateTo }, summary, providers };
    } catch {
      throw new InternalServerErrorException(
        'Analytics could not be retrieved',
      );
    }
  }

  private groupProviders(
    period: { $gte: Date; $lt: Date },
    type: BookingType,
    providerField: 'airlineId' | 'hotelId',
    providerCollection: string,
  ): GroupStage[] {
    return [
      { $match: { createdAt: period } },
      {
        $project: {
          providerId: '$' + providerField,
          // A paid booking stays revenue after the nightly sweep completes it (GEN-11).
          confirmed: {
            $in: ['$status', [BookingStatus.CONFIRMED, BookingStatus.COMPLETED]],
          },
          amount: checkedCents('$totalCents'),
          currency: { $toUpper: '$currency' },
        },
      },
      {
        $lookup: {
          from: this.refunds.collection.name,
          as: 'refund',
          let: {
            bookingId: { $cond: ['$confirmed', '$_id', null] },
            bookingCurrency: '$currency',
          },
          pipeline: [
            {
              $match: {
                bookingType: type,
                status: RefundStatus.REFUNDED,
                $expr: { $eq: ['$bookingId', '$$bookingId'] },
              },
            },
            {
              $project: {
                amount: checkedCents('$amountCents'),
                currency: { $toUpper: '$currency' },
              },
            },
            // One result per booking even if more than one payment has completed refunds.
            {
              $group: {
                _id: null,
                amount: { $sum: '$amount' },
                invalid: {
                  $sum: {
                    $cond: [
                      {
                        $and: [
                          { $gt: ['$amount', ZERO_CENTS] },
                          { $eq: ['$currency', '$$bookingCurrency'] },
                        ],
                      },
                      0,
                      1,
                    ],
                  },
                },
              },
            },
          ],
        },
      },
      {
        $set: {
          refunded: {
            $ifNull: [{ $arrayElemAt: ['$refund.amount', 0] }, ZERO_CENTS],
          },
          invalidRefunds: {
            $ifNull: [{ $arrayElemAt: ['$refund.invalid', 0] }, 0],
          },
        },
      },
      {
        $group: {
          _id: { providerId: '$providerId', currency: '$currency' },
          bookingCount: { $sum: 1 },
          confirmedBookingCount: { $sum: { $cond: ['$confirmed', 1, 0] } },
          revenueCents: {
            $sum: {
              $cond: [
                '$confirmed',
                { $subtract: ['$amount', '$refunded'] },
                ZERO_CENTS,
              ],
            },
          },
          invalidAmounts: {
            $sum: {
              $cond: [
                {
                  $and: [
                    '$confirmed',
                    {
                      $or: [
                        { $eq: ['$amount', null] },
                        {
                          $not: [
                            {
                              $regexMatch: {
                                input: '$currency',
                                regex: '^[A-Z]{3}$',
                              },
                            },
                          ],
                        },
                        { $gt: ['$refunded', '$amount'] },
                        { $gt: ['$invalidRefunds', 0] },
                      ],
                    },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
      { $sort: { '_id.providerId': 1, '_id.currency': 1 } },
      {
        $group: {
          _id: '$_id.providerId',
          bookingCount: { $sum: '$bookingCount' },
          confirmedBookingCount: { $sum: '$confirmedBookingCount' },
          invalidAmounts: { $sum: '$invalidAmounts' },
          currencies: {
            $push: {
              currency: '$_id.currency',
              count: '$confirmedBookingCount',
              revenueCents: '$revenueCents',
            },
          },
        },
      },
      {
        $lookup: {
          from: providerCollection,
          as: 'provider',
          localField: '_id',
          foreignField: '_id',
          pipeline: [{ $project: { _id: 0, name: 1 } }],
        },
      },
      {
        $project: {
          _id: 0,
          type: { $literal: type },
          providerId: { $toString: '$_id' },
          providerName: {
            $ifNull: [{ $arrayElemAt: ['$provider.name', 0] }, null],
          },
          bookingCount: 1,
          confirmedBookingCount: 1,
          invalidAmounts: 1,
          revenueByCurrency: {
            $map: {
              input: {
                $filter: {
                  input: '$currencies',
                  as: 'currency',
                  cond: { $gt: ['$$currency.count', 0] },
                },
              },
              as: 'currency',
              in: {
                currency: '$$currency.currency',
                revenueCents: '$$currency.revenueCents',
              },
            },
          },
        },
      },
    ];
  }
}
