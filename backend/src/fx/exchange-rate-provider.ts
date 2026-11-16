import { Injectable } from '@nestjs/common';

export interface FetchedRates {
  base: string;
  /** YYYY-MM-DD, as reported by the provider. */
  rateDate: string;
  rates: Record<string, number>;
}

/**
 * Fetches today's exchange rates for `base` from the outside world. Owned by Payments (ITN-18).
 * Never caches or falls back itself — that is FxService.ensureTodaysRates' job; this throws on
 * any failure (network, non-2xx, malformed body) so the caller can decide what to do about it.
 */
export interface ExchangeRateProvider {
  fetchLatest(base: string): Promise<FetchedRates>;
}

/** DI token for ExchangeRateProvider (an interface has no runtime value to inject by). */
export const EXCHANGE_RATE_PROVIDER = Symbol('EXCHANGE_RATE_PROVIDER');

interface FxRatesApiResponse {
  success?: boolean;
  base?: string;
  date?: string;
  rates?: Record<string, number>;
}

/**
 * Real implementation, calling FXRatesAPI (https://fxratesapi.com) with Node's global fetch —
 * the first outbound HTTP call in this codebase, so no sibling pattern to copy. FX_API_KEY is
 * optional: FXRatesAPI has a usable free tier, and the key is appended only when configured.
 * Reads `process.env` directly (like `PLATFORM_CURRENCY` in `common/constants.ts`) rather than
 * injecting `ConfigService`, so FxModule has no dependency on `AppModule`'s global ConfigModule
 * being present — several existing test suites build `ItinerariesModule` in isolation without it.
 */
@Injectable()
export class HttpExchangeRateProvider implements ExchangeRateProvider {
  private static readonly BASE_URL = 'https://api.fxratesapi.com/latest';
  private static readonly TIMEOUT_MS = 5000;

  async fetchLatest(base: string): Promise<FetchedRates> {
    const apiKey = process.env.FX_API_KEY;
    const url = new URL(HttpExchangeRateProvider.BASE_URL);
    url.searchParams.set('base', base);
    if (apiKey) url.searchParams.set('api_key', apiKey);

    // The request itself carries FX_API_KEY in its query string. A network-level failure from
    // `fetch` (DNS, connection reset, timeout) can embed the request URL in its own message, so
    // that error is never rethrown or logged as-is — only this safe, key-free message is.
    let res: Response;
    try {
      res = await fetch(url, {
        signal: AbortSignal.timeout(HttpExchangeRateProvider.TIMEOUT_MS),
      });
    } catch {
      throw new Error(`FXRatesAPI request failed for base ${base}`);
    }
    if (!res.ok) {
      throw new Error(`FXRatesAPI responded ${res.status} ${res.statusText}`);
    }
    const body = (await res.json()) as FxRatesApiResponse;
    if (!body.rates) {
      throw new Error('FXRatesAPI response is missing rates');
    }
    return {
      base,
      rateDate: body.date ?? new Date().toISOString().slice(0, 10),
      rates: body.rates,
    };
  }
}
