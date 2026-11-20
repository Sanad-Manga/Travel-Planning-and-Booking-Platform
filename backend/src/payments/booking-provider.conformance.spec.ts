import { BookingStatus } from '../common';
import {
  CONFORMANCE_BOOKING_ID,
  CONFORMANCE_HOLD_EXPIRES_AT,
  runBookingProviderConformanceTests,
} from './booking-provider.conformance';
import { FakeBookingProvider } from './fake-booking-provider';

describe('FakeBookingProvider (conformance self-test)', () => {
  runBookingProviderConformanceTests(() => {
    const provider = new FakeBookingProvider();
    provider.add(
      CONFORMANCE_BOOKING_ID,
      BookingStatus.PENDING_PAYMENT,
      CONFORMANCE_HOLD_EXPIRES_AT,
    );
    return { provider, unknownId: 'no-such-booking' };
  });
});
