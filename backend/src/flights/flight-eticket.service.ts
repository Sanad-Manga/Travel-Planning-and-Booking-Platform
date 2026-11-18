import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { CabinClass, PassengerType, utcToLocal } from '../common';
import {
  FlightBookingLean,
  getFlightBookingSegments,
} from './schemas/flight-booking.schema';
import { FlightLean } from './schemas/flight.schema';

/** What the traveler sees on the PDF: names/types only, never passport or identity numbers. */
export interface FlightETicketPassenger {
  fullName: string;
  passengerType: PassengerType;
}

export interface FlightETicketSegment {
  flightNumber: string;
  departureAirport: string;
  arrivalAirport: string;
  departureLocal: string;
  arrivalLocal: string;
  cabinClass: CabinClass;
  seats: number;
}

export interface FlightETicketData {
  bookingReference: string;
  bookingId: string;
  issuedAt: string;
  passengers: FlightETicketPassenger[];
  passengerCounts: { adults: number; children: number; infants: number };
  segments: FlightETicketSegment[];
}

/** FLT-23: the bytes and attachment name for one authorized e-ticket download. */
export interface FlightETicketFile {
  buffer: Buffer;
  filename: string;
  bookingReference: string;
}

/**
 * FLT-23: renders an authorized request's e-ticket in memory. The PDF is never written to the
 * uploads folder or any other public location, and it carries no payment or identity-document data.
 */
@Injectable()
export class FlightETicketService {
  /**
   * Pure shaping step, so round-trip tickets can be checked without parsing PDF bytes. `flights`
   * must be in the same outbound-then-return order as the booking's segments.
   */
  buildData(
    booking: FlightBookingLean,
    flights: FlightLean[],
    issuedAt: Date = new Date(),
  ): FlightETicketData {
    const segments = getFlightBookingSegments(booking).map((segment, index) => {
      const flight = flights[index];
      return {
        flightNumber: flight.flightNumber,
        departureAirport: flight.departureAirport,
        arrivalAirport: flight.arrivalAirport,
        departureLocal: utcToLocal(
          flight.departureAt,
          flight.departureTimeZone,
        ),
        arrivalLocal: utcToLocal(flight.arrivalAt, flight.arrivalTimeZone),
        cabinClass: segment.cabinClass,
        seats: segment.seats,
      };
    });

    return {
      bookingReference: booking.bookingReference ?? '',
      bookingId: booking._id.toString(),
      issuedAt: issuedAt.toISOString(),
      passengers: (booking.passengers ?? []).map((passenger) => ({
        fullName: passenger.fullName,
        passengerType: passenger.passengerType,
      })),
      passengerCounts: {
        adults: booking.passengerCounts.adults,
        children: booking.passengerCounts.children,
        infants: booking.passengerCounts.infants,
      },
      segments,
    };
  }

  async render(data: FlightETicketData): Promise<Buffer> {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    const finished = new Promise<Buffer>((resolve, reject) => {
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    try {
      this.write(doc, data);
      doc.end();
    } catch (error) {
      doc.emit('error', error);
    }
    return finished;
  }

  private write(doc: PDFKit.PDFDocument, data: FlightETicketData): void {
    doc.fontSize(22).text('E-TICKET', { align: 'center' });
    doc.moveDown(0.25);
    doc
      .fontSize(10)
      .fillColor('#555555')
      .text('Electronic flight ticket', { align: 'center' });
    doc.fillColor('#000000');

    doc.moveDown(1.25);
    doc.fontSize(12).text(`Booking reference: ${data.bookingReference}`);
    doc.fontSize(11).text(`Booking ID: ${data.bookingId}`);
    doc.fontSize(11).text(`Issued: ${data.issuedAt}`);

    doc.moveDown();
    doc.fontSize(14).text('Passengers');
    if (data.passengers.length > 0) {
      for (const passenger of data.passengers) {
        doc
          .fontSize(11)
          .text(`${passenger.fullName} (${passenger.passengerType})`);
      }
    } else {
      doc
        .fontSize(11)
        .text(
          `Adults: ${data.passengerCounts.adults} | Children: ${data.passengerCounts.children} | Infants: ${data.passengerCounts.infants}`,
        );
    }

    doc.moveDown();
    doc.fontSize(14).text('Itinerary');
    data.segments.forEach((segment, index) => {
      const leg =
        data.segments.length === 2
          ? index === 0
            ? ' - Outbound'
            : ' - Return'
          : '';
      doc.moveDown(0.5);
      doc
        .fontSize(12)
        .text(`Segment ${index + 1}${leg}: ${segment.flightNumber}`);
      doc
        .fontSize(11)
        .text(`${segment.departureAirport} -> ${segment.arrivalAirport}`);
      doc.fontSize(11).text(`Departs: ${segment.departureLocal}`);
      doc.fontSize(11).text(`Arrives: ${segment.arrivalLocal}`);
      doc
        .fontSize(11)
        .text(`Cabin: ${segment.cabinClass} | Seats: ${segment.seats}`);
    });

    doc.moveDown(1.5);
    doc
      .fontSize(9)
      .fillColor('#555555')
      .text(
        'Present this e-ticket with a valid identity document at check-in. ' +
          'This ticket stores no identity-document number and no payment data.',
      );
  }
}
