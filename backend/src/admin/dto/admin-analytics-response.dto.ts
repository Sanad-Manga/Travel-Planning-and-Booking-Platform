import { ApiProperty } from '@nestjs/swagger';
import { BookingType } from '../../common';
import { AdminAnalyticsQueryDto } from './admin-analytics-query.dto';

class AnalyticsSummaryDto {
  @ApiProperty({ type: 'integer', description: 'Bookings of all statuses.' })
  totalBookings: number;

  @ApiProperty({ type: 'integer' })
  flightBookings: number;

  @ApiProperty({ type: 'integer' })
  hotelBookings: number;

  @ApiProperty({
    type: 'integer',
    description:
      'Bookings currently CONFIRMED, including those that net to zero.',
  })
  confirmedBookings: number;
}

class AnalyticsRevenueDto {
  @ApiProperty({ example: 'EGP' })
  currency: string;

  @ApiProperty({
    type: 'integer',
    minimum: 0,
    description:
      'Total confirmed booking cents less completed refunds in this currency.',
  })
  revenueCents: number;
}

class AnalyticsProviderDto {
  @ApiProperty({ enum: BookingType })
  type: BookingType;

  @ApiProperty({ type: String })
  providerId: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Null when the referenced provider is missing.',
  })
  providerName: string | null;

  @ApiProperty({ type: 'integer', description: 'Bookings of all statuses.' })
  bookingCount: number;

  @ApiProperty({
    type: 'integer',
    description: 'Bookings currently CONFIRMED.',
  })
  confirmedBookingCount: number;

  @ApiProperty({
    type: [AnalyticsRevenueDto],
    description:
      'One net total per confirmed booking currency, ordered by code. Empty when there are no confirmed bookings. Counts belong to the provider, not the currency rows.',
  })
  revenueByCurrency: AnalyticsRevenueDto[];
}

export class AdminAnalyticsResponseDto {
  @ApiProperty({ type: AdminAnalyticsQueryDto })
  period: AdminAnalyticsQueryDto;

  @ApiProperty({ type: AnalyticsSummaryDto })
  summary: AnalyticsSummaryDto;

  @ApiProperty({
    type: [AnalyticsProviderDto],
    description: 'Ordered by booking type and provider ID.',
  })
  providers: AnalyticsProviderDto[];
}
