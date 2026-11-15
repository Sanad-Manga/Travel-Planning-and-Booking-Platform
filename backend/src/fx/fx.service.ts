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
  private readonly logger = new Logger(FxService.name);

  constructor(
    @InjectModel(ExchangeRate.name)
    private readonly rates: Model<ExchangeRate>,
    @Inject(EXCHANGE_RATE_PROVIDER)
    private readonly provider: ExchangeRateProvider,
    private readonly referenceData: ReferenceDataService,
  ) {}

  /** Converts an integer-cents amount; `rateDate` is the date of the rate(s) actually used. */
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
   */
  async ensureTodaysRates(base: string): Promise<ExchangeRateLean> {
    const rateDate = today();
    const cached = await this.rates
      .findOne({ base, rateDate })
      .lean<ExchangeRateLean>()
      .exec();
    if (cached) return cached;

    try {
      const fetched = await this.provider.fetchLatest(base);
      return await this.cache(base, fetched.rateDate, fetched.rates);
    } catch (error) {
      this.logger.error(
        `FXRatesAPI fetch failed for base ${base}`,
        error instanceof Error ? error.stack : String(error),
      );
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
