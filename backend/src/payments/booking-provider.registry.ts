import { Injectable } from '@nestjs/common';
import { BookingType } from '../common';
import { BookingLifecycleProvider } from './booking-provider.interface';

/**
 * Booking owners register themselves here (e.g. in onModuleInit: `registry.register(BookingType.FLIGHT, this)`).
 * A registry instead of injected tokens means PaymentsModule never imports the booking modules,
 * so there are no circular module imports.
 */
@Injectable()
export class BookingProviderRegistry {
  private readonly providers = new Map<BookingType, BookingLifecycleProvider>();

  register(type: BookingType, provider: BookingLifecycleProvider): void {
    this.providers.set(type, provider);
  }

  registeredTypes(): BookingType[] {
    return [...this.providers.keys()];
  }

  get(type: BookingType): BookingLifecycleProvider {
    const provider = this.providers.get(type);
    if (!provider)
      throw new Error(`No booking provider registered for ${type}`);
    return provider;
  }
}
