import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BookingStatus, CabinClass, PassengerType } from '../../common';
import { FlightBookingLean } from '../schemas/flight-booking.schema';

export class PassengerCountsDto {
  @ApiProperty({ example: 2 }) adults: number;
  @ApiProperty({ example: 1 }) children: number;
  @ApiProperty({ example: 1 }) infants: number;
}

export class ExtraBagResponseDto {
  @ApiProperty({ example: 18.5, description: 'Weight of this extra bag in kg' })
  weightKg: number;
}

export class BookingPassengerResponseDto {
  @ApiProperty({ example: 'Amina Example' })
  fullName: string;

  @ApiProperty({
    example: '2010-05-21',
    description: 'Date of birth (YYYY-MM-DD)',
  })
  dateOfBirth: string;

  @ApiProperty({ enum: PassengerType, example: PassengerType.CHILD })
  passengerType: PassengerType;

  @ApiProperty({ type: [ExtraBagResponseDto] })
  extraBags: ExtraBagResponseDto[];

  @ApiProperty({
    example: 3000,
    description: "This passenger's extra-baggage fee in cents",
  })
  baggageFeeCents: number;
}

export class FlightBookingResponseDto {
  @ApiProperty({ example: '674a1b2c3d4e5f6a7b8c9d0f' }) id: string;
  @ApiProperty({ example: '674a1b2c3d4e5f6a7b8c9d0e' }) flightId: string;
  @ApiProperty({ enum: CabinClass, example: CabinClass.ECONOMY })
  cabinClass: CabinClass;
  @ApiProperty({ type: PassengerCountsDto })
  passengerCounts: PassengerCountsDto;
  @ApiPropertyOptional({ type: [BookingPassengerResponseDto] })
  passengers?: BookingPassengerResponseDto[];
  @ApiProperty({
    example: 3,
    description: 'Seats held: adults + children (infants take none)',
  })
  seats: number;
  @ApiProperty({ example: 45000, description: 'Fare per adult/child in cents' })
  farePerPassengerCents: number;
  @ApiProperty({ example: 4500, description: 'Fare per infant in cents' })
  infantFareCents: number;
  @ApiProperty({ example: 139500, description: 'Total to pay in cents' })
  totalCents: number;
  @ApiProperty({
    example: 3000,
    description: 'Extra-baggage fees included in totalCents',
  })
  baggageFeeCents: number;
  @ApiProperty({ example: 'USD' }) currency: string;
  @ApiProperty({ enum: BookingStatus, example: BookingStatus.PENDING_PAYMENT })
  status: BookingStatus;
  @ApiProperty({
    example: '2026-11-07T12:10:00.000Z',
    nullable: true,
    description:
      'UTC. The seats are released if the booking is not paid by then.',
  })
  holdExpiresAt: string | null;
  @ApiProperty({ example: '2026-11-07T12:00:00.000Z' }) createdAt: string;
}

/** Response DTO, never the raw document: `_id` becomes `id`, ObjectIds become strings, `__v` is dropped. */
export function toFlightBookingResponse(
  doc: FlightBookingLean,
): FlightBookingResponseDto {
  return {
    id: doc._id.toString(),
    flightId: doc.flightId.toString(),
    cabinClass: doc.cabinClass,
    passengerCounts: {
      adults: doc.passengerCounts.adults,
      children: doc.passengerCounts.children,
      infants: doc.passengerCounts.infants,
    },
    ...(doc.passengers
      ? {
          passengers: doc.passengers.map((passenger) => ({
            fullName: passenger.fullName,
            dateOfBirth: passenger.dateOfBirth,
            passengerType: passenger.passengerType,
            extraBags: passenger.extraBags.map((bag) => ({
              weightKg: bag.weightKg,
            })),
            baggageFeeCents: passenger.baggageFeeCents,
          })),
        }
      : {}),
    seats: doc.seats,
    farePerPassengerCents: doc.farePerPassengerCents,
    infantFareCents: doc.infantFareCents,
    totalCents: doc.totalCents,
    baggageFeeCents: doc.baggageFeeCents ?? 0,
    currency: doc.currency,
    status: doc.status,
    holdExpiresAt: doc.holdExpiresAt ? doc.holdExpiresAt.toISOString() : null,
    createdAt: doc.createdAt.toISOString(),
  };
}
