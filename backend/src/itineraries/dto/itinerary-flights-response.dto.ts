import { ApiProperty, getSchemaPath } from '@nestjs/swagger';
import {
  FlightRoundTripSearchResponseDto,
  FlightSearchPageDto,
} from '../../flights/dto/flight-search-response.dto';
import { ItineraryTripType } from './itinerary-flights-query.dto';

export class ItineraryFlightAirportDto {
  @ApiProperty({ example: 'CAI' }) iataCode: string;
  @ApiProperty({ example: 'Cairo International Airport' }) name: string;
}

export class ItineraryFlightDestinationDto {
  @ApiProperty({ type: ItineraryFlightAirportDto })
  airport: ItineraryFlightAirportDto;

  @ApiProperty({
    oneOf: [
      { $ref: getSchemaPath(FlightSearchPageDto) },
      { $ref: getSchemaPath(FlightRoundTripSearchResponseDto) },
    ],
    description:
      'The answer of the flight search (FLT-11, FLT-12) for this airport: one page of flights for a ONE_WAY search, outbound and return pages for a ROUND_TRIP.',
  })
  results: FlightSearchPageDto | FlightRoundTripSearchResponseDto;
}

/** What GET /api/itineraries/:id/flights answers (ITN-26). */
export class ItineraryFlightsDto {
  @ApiProperty({
    enum: ItineraryTripType,
    example: ItineraryTripType.ROUND_TRIP,
  })
  tripType: ItineraryTripType;

  @ApiProperty({ example: 'LHR', description: 'The origin airport searched.' })
  departureAirport: string;

  @ApiProperty({
    example: 'cairo',
    description: 'City of the first day of the itinerary.',
  })
  destinationCityId: string;

  @ApiProperty({
    example: '2026-12-20',
    description: 'The outbound date that was searched.',
  })
  departureDate: string;

  @ApiProperty({
    example: '2026-12-27',
    nullable: true,
    type: String,
    description: 'The return date that was searched; null for ONE_WAY.',
  })
  returnDate: string | null;

  @ApiProperty({
    type: [ItineraryFlightDestinationDto],
    description:
      'One entry per airport of the destination city (the origin airport is left out), ordered by IATA code.',
  })
  destinations: ItineraryFlightDestinationDto[];
}
