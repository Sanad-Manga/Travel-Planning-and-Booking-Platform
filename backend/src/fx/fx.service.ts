import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PLATFORM_CURRENCY } from '../common';
import { ReferenceDataService } from '../reference-data/reference-data.service';
import {
  EXCHANGE_RATE_PROVIDER,
  ExchangeRateProvider,
} from './exchange-rate-provider';
import { ExchangeRate, ExchangeRateLean } from './schemas/exchange-rate.schema';

/**
 * ITN-18: converts an amount between currencies using exchange rates fetched once per day from
 * FXRatesAPI and cached in the database, relative to PLATFORM_CURRENCY. Booking prices are never
 * converted (PAY-04) — this is only for itinerary budgets.
 */
@Injectable()
export class FxService {
  private static readonly FAILURE_BACKOFF_MS = 5 * 60_000;

  private readonly logger = new Logger(FxService.name);
  /** Last time `fetchLatest(base)` failed, so a run of calls while the API is down don't each pay the request/timeout cost. */
  private readonly lastFailureAt = new Map<string, number>();

  constructor(
    @InjectModel(ExchangeRate.name)
    private readonly rates: Model<ExchangeRate>,
    @Inject(EXCHANGE_RATE_PROVIDER)
    private readonly provider: ExchangeRateProvider,
    private readonly referenceData: ReferenceDataService,
  ) {}

  /**
   * Converts an integer-cents amount; `rateDate` is the date of the rate(s) actually used.
   * Assumes every currency involved uses 2 decimal places (1 unit = 100 minor units), matching
   * the `...Cents` convention used everywhere else in this codebase (docs/contracts.md section 3).
   * A 0- or 3-decimal currency (e.g. JPY, KWD) in the supported currency list (GEN-12) would be
   * off by a factor of 10 or 100 here; the itinerary budgets this backs only ever use the small
   * currency set this project seeds, so this is not handled.
   */
  async convert(
    amountCents: number,
    from: string,
    to: string,
  ): Promise<{ amount: number; rateDate: string }> {
    await this.assertCurrency(from, 'from');
    await this.assertCurrency(to, 'to');

    if (from === to) {
      return { amount: amountCents, rateDate: today() };
    }

    const base = PLATFORM_CURRENCY;
    const cached = await this.ensureTodaysRates(base);

    const rateFrom = from === base ? 1 : cached.rates[from];
    const rateTo = to === base ? 1 : cached.rates[to];
    if (rateFrom === undefined || rateTo === undefined) {
      throw new ServiceUnavailableException(
        `No cached exchange rate available for ${from} or ${to}`,
      );
    }

    const amountInBase = amountCents / rateFrom;
    return {
      amount: Math.round(amountInBase * rateTo),
      rateDate: cached.rateDate,
    };
  }

  /**
   * Returns today's cached rates for `base`, fetching and caching them on the first call of the
   * day. Shared by `convert` (lazy check) and FxRateRefreshJob (the daily cron) so there is
   * exactly one fetch-and-cache code path. On a fetch failure, falls back to the most recent
   * cached row for `base`, any age — a stale-but-correct answer beats a 500. Only throws when
   * nothing has ever been cached for `base`.
   *
   * While the API is down, repeated calls skip straight to the stale-cache fallback for
   * FAILURE_BACKOFF_MS instead of each paying another request/timeout against FXRatesAPI — one
   * budget-summary page can otherwise call `convert` once per currency block in play.
   */
  async ensureTodaysRates(base: string): Promise<ExchangeRateLean> {
    const rateDate = today();
    const cached = await this.rates
      .findOne({ base, rateDate })
      .lean<ExchangeRateLean>()
      .exec();
    if (cached) return cached;

    if (this.isInFailureBackoff(base)) {
      return this.staleRatesOrThrow(base);
    }

    try {
      // Cache under the date WE fetched it (`rateDate`, i.e. today), never the provider's own
      // reported date: a provider that reports a timestamp, yesterday's date, or any value that
      // isn't exactly today's YYYY-MM-DD would otherwise never be found by the lookup above,
      // forcing a fresh external call on every single request.
      const fetched = await this.provider.fetchLatest(base);
      this.lastFailureAt.delete(base);
      return await this.cache(base, rateDate, fetched.rates);
    } catch (error) {
      this.lastFailureAt.set(base, Date.now());
      this.logger.error(
        `FXRatesAPI fetch failed for base ${base}`,
        error instanceof Error ? error.stack : String(error),
      );
      return this.staleRatesOrThrow(base);
    }
  }

  private isInFailureBackoff(base: string): boolean {
    const last = this.lastFailureAt.get(base);
    return (
      last !== undefined &&
      Date.now() - last < FxService.FAILURE_BACKOFF_MS
    );
  }

  private async staleRatesOrThrow(base: string): Promise<ExchangeRateLean> {
    const stale = await this.rates
      .findOne({ base })
      .sort({ createdAt: -1 })
      .lean<ExchangeRateLean>()
      .exec();
    if (stale) return stale;
    throw new ServiceUnavailableException(
      `Exchange rates are unavailable for ${base} and none are cached yet`,
    );
  }

  /** Upsert so a cron/lazy-check race on the same (base, date) never raises a duplicate-key error. */
  private async cache(
    base: string,
    rateDate: string,
    rates: Record<string, number>,
  ): Promise<ExchangeRateLean> {
    const doc = await this.rates
      .findOneAndUpdate(
        { base, rateDate },
        { $set: { rates } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .lean<ExchangeRateLean>()
      .exec();
    return doc!;
  }

  private async assertCurrency(currency: string, field: string): Promise<void> {
    if (!(await this.referenceData.findCurrencyById(currency))) {
      throw new BadRequestException({
        message: 'Validation failed',
        details: [{ field, message: `unsupported currency: ${currency}` }],
      });
    }
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
