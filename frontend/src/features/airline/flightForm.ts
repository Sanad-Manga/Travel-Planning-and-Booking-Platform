export interface FlightFormValues {
  flightNumber: string;
  departureAirport: string;
  arrivalAirport: string;
  /** Local time at the departure airport, `YYYY-MM-DDTHH:mm` (what a datetime-local input holds). */
  departureLocalTime: string;
  /** Local time at the arrival airport, same format. */
  arrivalLocalTime: string;
}

export type FlightFormErrors = Partial<Record<keyof FlightFormValues, string>>;

/** The backend rule: 2-3 letters or digits for the airline, then 1-4 digits. It upper-cases the number itself. */
const FLIGHT_NUMBER = /^[A-Z0-9]{2,3}\d{1,4}$/i;

/**
 * FLT-03: catches silly input only (empty, wrong shape, same airport twice). The backend stays the judge, for
 * example whether the arrival is after the departure, which needs both airports' time zones.
 */
export function validateFlight(values: FlightFormValues): FlightFormErrors {
  const errors: FlightFormErrors = {};
  if (!values.flightNumber.trim()) errors.flightNumber = 'Enter the flight number.';
  else if (!FLIGHT_NUMBER.test(values.flightNumber.trim())) {
    errors.flightNumber = 'Use a flight number like MS777: 2-3 letters or digits, then 1-4 digits.';
  }
  if (!values.departureAirport) errors.departureAirport = 'Choose the departure airport.';
  if (!values.arrivalAirport) errors.arrivalAirport = 'Choose the arrival airport.';
  else if (values.arrivalAirport === values.departureAirport) errors.arrivalAirport = 'Choose a different airport from the departure one.';
  if (!values.departureLocalTime) errors.departureLocalTime = 'Enter the departure date and time.';
  if (!values.arrivalLocalTime) errors.arrivalLocalTime = 'Enter the arrival date and time.';
  return errors;
}
