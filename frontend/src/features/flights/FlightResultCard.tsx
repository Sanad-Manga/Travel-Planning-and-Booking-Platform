import type { FlightCabinOption, FlightSearchItem } from '@/api/flights';
import { formatInZone } from '@/lib/formatInZone';
import { formatMoney } from '@/lib/formatMoney';
import { CABIN_LABELS, formatDuration } from './searchParams';

export interface FlightResultCardProps {
  flight: FlightSearchItem;
  /** How many travellers need a seat; used for the cabin total. */
  passengers: number;
}

/**
 * FLT-11: one flight with its two airport-local times, its duration and the cabins that still have
 * enough seats. FLT-15: the price is the cabin fare formatted by the shared money helper.
 */
export function FlightResultCard({ flight, passengers }: FlightResultCardProps) {
  return (
    <article className="flight-card" aria-label={`${flight.airline.name} flight ${flight.flightNumber}`}>
      <header className="flight-card-header">
        <div>
          <p className="flight-airline">{flight.airline.name}</p>
          <p className="flight-number">{flight.flightNumber}</p>
        </div>
        <p className="flight-route" aria-label={`${flight.departureAirport} to ${flight.arrivalAirport}`}>
          <span>{flight.departureAirport}</span>
          <span aria-hidden="true">&#8594;</span>
          <span>{flight.arrivalAirport}</span>
        </p>
      </header>

      <dl className="flight-times">
        <div>
          <dt>Departs</dt>
          <dd>
            <time dateTime={flight.departureAt}>{formatInZone(flight.departureAt, flight.departureTimeZone, { showZone: true })}</time>
            <span className="flight-airport">{flight.departureAirport}</span>
          </dd>
        </div>
        <div>
          <dt>Arrives</dt>
          <dd>
            <time dateTime={flight.arrivalAt}>{formatInZone(flight.arrivalAt, flight.arrivalTimeZone, { showZone: true })}</time>
            <span className="flight-airport">{flight.arrivalAirport}</span>
          </dd>
        </div>
        <div>
          <dt>Duration</dt>
          <dd>{formatDuration(flight.departureAt, flight.arrivalAt)}</dd>
        </div>
      </dl>

      <div className="flight-cabins">
        <p className="flight-cabins-legend">Cabin and fare</p>
        {flight.cabins.length === 0 ? (
          <p className="field-hint">No cabin has enough seats for this search.</p>
        ) : (
          <ul className="flight-cabin-list">
            {flight.cabins.map((cabin) => (
              <CabinRow key={cabin.cabinClass} cabin={cabin} currency={flight.currency} passengers={passengers} />
            ))}
          </ul>
        )}
      </div>
    </article>
  );
}

function CabinRow({ cabin, currency, passengers }: { cabin: FlightCabinOption; currency: string; passengers: number }) {
  return (
    <li className="flight-cabin">
      <span className="flight-cabin-name">{CABIN_LABELS[cabin.cabinClass]}</span>
      <span className="flight-cabin-price">
        {formatMoney(cabin.priceCents, currency)} <span className="field-hint">per passenger</span>
      </span>
      <span className="flight-cabin-seats">{cabin.availableSeats} seats left</span>
      <span className="flight-cabin-total">
        {formatMoney(cabin.priceCents * passengers, currency)} for {passengers} {passengers === 1 ? 'passenger' : 'passengers'}
      </span>
    </li>
  );
}
