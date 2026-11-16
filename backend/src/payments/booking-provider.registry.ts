import { Injectable } from '@nestjs/common';
import { BookingType } from '../common';
import { BookingProvider } from './booking-provider.interface';

/**
 * Booking owners register themselves here (e.g. in onModuleInit: `registry.register(BookingType.FLIGHT, this)`).
 * A registry instead of injected tokens means PaymentsModule never imports the booking modules,
 * so there are no circular module imports.
 */
@Injectable()
export class BookingProviderRegistry {
  private readonly providers = new Map<BookingType, BookingProvider>();

  register(type: BookingType, provider: BookingProvider): void {
    this.providers.set(type, provider);
  }

  registeredTypes(): BookingType[] {
    return [...this.providers.keys()];
  }

  get(type: BookingType): BookingProvider {
    const provider = this.providers.get(type);
    if (!provider)
      throw new Error(`No booking provider registered for ${type}`);
    return provider;
  }

  /**
   * Same lookup as {@link get}, but returns undefined instead of throwing. For a caller to
   * whom an unregistered type is an expected, routine condition (PAY-02: HOTEL has no
   * provider until HTL-16 lands) rather than a bug — it must turn this into its own clean
   * 4xx, not let the global filter turn a thrown Error into a 500.
   */
  tryGet(type: BookingType): BookingProvider | undefined {
    return this.providers.get(type);
  }
}
