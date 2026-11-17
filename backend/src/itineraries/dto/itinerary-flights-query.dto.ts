import { ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, Matches } from 'class-validator';
import { FlightSearchQueryDto } from '../../flights/dto/flight-search-query.dto';

/** One-way or round trip (ITN-26). */
export enum ItineraryTripType {
  ONE_WAY = 'ONE_WAY',
  ROUND_TRIP = 'ROUND_TRIP',
}

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Query of GET /api/itineraries/:id/flights (ITN-26). It is the query of the flight search (FLT-11, FLT-12, FLT-15)
 * without the three things the itinerary decides: the destination (every airport of the city of the first day) and
 * the two dates, which default to the itinerary's own dates and can be overridden here. Everything else (origin
 * airport, passengers, cabin class, price range, sort, paging) is the flight search's own DTO, so its rules and its
 * messages are not written a second time.
 */
export class ItineraryFlightsQueryDto extends OmitType(FlightSearchQueryDto, [
  'arrivalAirport',
  'departureDate',
  'returnDate',
] as const) {
  @ApiPropertyOptional({
    enum: ItineraryTripType,
    default: ItineraryTripType.ROUND_TRIP,
    description:
      'ONE_WAY searches the outbound flights only. ROUND_TRIP (the default) also searches the way back.',
  })
  @IsOptional()
  @IsEnum(ItineraryTripType, {
    message: 'tripType must be one of: ONE_WAY, ROUND_TRIP',
  })
  tripType: ItineraryTripType = ItineraryTripType.ROUND_TRIP;

  @ApiPropertyOptional({
    example: '2026-12-20',
    description:
      "Outbound date (YYYY-MM-DD). Defaults to the itinerary's start date, which is the date of its first day.",
  })
  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'departureDate must be a string' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'departureDate must be YYYY-MM-DD',
  })
  departureDate?: string;

  @ApiPropertyOptional({
    example: '2026-12-27',
    description:
      "Return date (YYYY-MM-DD), for a ROUND_TRIP only. Defaults to the date of the itinerary's last day.",
  })
  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'returnDate must be a string' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'returnDate must be YYYY-MM-DD',
  })
  returnDate?: string;
}
