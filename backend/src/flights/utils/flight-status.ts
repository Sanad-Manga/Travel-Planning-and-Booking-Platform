import { FlightStatus } from '../../common';

/**
 * FLT-30: the status a client should see. The stored status only changes when the scheduled job runs
 * (flight-status.job.ts), so a SCHEDULED flight whose departure time has passed is already DEPARTED here.
 * CANCELLED and DEPARTED are final and are returned as stored.
 */
export function effectiveFlightStatus(
  flight: { status: FlightStatus; departureAt: Date },
  now: Date = new Date(),
): FlightStatus {
  if (
    flight.status === FlightStatus.SCHEDULED &&
    flight.departureAt.getTime() <= now.getTime()
  ) {
    return FlightStatus.DEPARTED;
  }
  return flight.status;
}
