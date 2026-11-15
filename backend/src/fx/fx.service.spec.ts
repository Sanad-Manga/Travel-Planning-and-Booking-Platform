import {
  BadRequestException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Model, Types } from 'mongoose';
import { ExchangeRateProvider, FetchedRates } from './exchange-rate-provider';
import { FxService } from './fx.service';
import { ExchangeRate, ExchangeRateLean } from './schemas/exchange-rate.schema';

/** Hand-written fake, mirroring FakePaymentActivity's style: queue canned results, count calls. */
class FakeExchangeRateProvider implements ExchangeRateProvider {
  calls = 0;
  private next: FetchedRates | Error | null = null;

  queue(result: FetchedRates | Error): void {
    this.next = result;
  }

  async fetchLatest(base: string): Promise<FetchedRates> {
    this.calls++;
    if (this.next instanceof Error) throw this.next;
    if (this.next) return this.next;
    return { base, rateDate: TODAY, rates: {} };
  }
}

/** Minimal in-memory stand-in for `Model<ExchangeRate>` — only the calls FxService makes. */
class FakeExchangeRateModel {
  private readonly rows: ExchangeRateLean[] = [];

  seed(
    row: Omit<ExchangeRateLean, '_id' | 'createdAt' | 'updatedAt'> & {
      createdAt?: Date;
    },
  ): void {
    this.rows.push({
      _id: new Types.ObjectId(),
      createdAt: row.createdAt ?? new Date(),
      updatedAt: new Date(),
      ...row,
    });
  }

  findOne(filter: { base: string; rateDate?: string }) {
    return {
      lean: () => ({
        exec: async () => {
          const matches = this.rows.filter(
            (r) =>
              r.base === filter.base &&
              (filter.rateDate === undefined || r.rateDate === filter.rateDate),
          );
          return matches[0] ?? null;
        },
      }),
      sort: (sortSpec: { createdAt: number }) => ({
        lean: () => ({
          exec: async () => {
            const matches = this.rows
              .filter((r) => r.base === filter.base)
              .sort((a, b) =>
                sortSpec.createdAt < 0
                  ? b.createdAt.getTime() - a.createdAt.getTime()
                  : a.createdAt.getTime() - b.createdAt.getTime(),
              );
            return matches[0] ?? null;
          },
        }),
      }),
    };
  }

  findOneAndUpdate(
    filter: { base: string; rateDate: string },
    update: { $set: { rates: Record<string, number> } },
  ) {
    return {
      lean: () => ({
        exec: async () => {
          let row = this.rows.find(
            (r) => r.base === filter.base && r.rateDate === filter.rateDate,
          );
          if (!row) {
            row = {
              _id: new Types.ObjectId(),
              base: filter.base,
              rateDate: filter.rateDate,
              rates: update.$set.rates,
              createdAt: new Date(),
              updatedAt: new Date(),
            };
            this.rows.push(row);
          } else {
            row.rates = update.$set.rates;
          }
          return row;
        },
      }),
    };
  }
}

const TODAY = new Date().toISOString().slice(0, 10);
const YESTERDAY = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
const USD = 'USD';
const EUR = 'EUR';
const KNOWN_CODES = new Set([USD, EUR, 'ZZZ' /* kept unknown on purpose */]);

function fakeReferenceData() {
  return {
    findCurrencyById: jest.fn(async (code: string) =>
      KNOWN_CODES.has(code) && code !== 'ZZZ' ? { code } : null,
    ),
  };
}

describe('FxService', () => {
  let provider: FakeExchangeRateProvider;
  let model: FakeExchangeRateModel;
  let referenceData: ReturnType<typeof fakeReferenceData>;
  let service: FxService;
  let errorLog: jest.SpyInstance;

  beforeEach(() => {
    errorLog = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    provider = new FakeExchangeRateProvider();
    model = new FakeExchangeRateModel();
    referenceData = fakeReferenceData();
    service = new FxService(
      model as unknown as Model<ExchangeRate>,
      provider,
      referenceData as never,
    );
  });

  afterEach(() => {
    errorLog.mockRestore();
  });

  it('short-circuits when from === to: no provider call, no DB read, amount unchanged', async () => {
    const result = await service.convert(1999, USD, USD);
    expect(result).toEqual({ amount: 1999, rateDate: TODAY });
    expect(provider.calls).toBe(0);
  });

  it('fetches and caches on the first call of the day, then converts correctly (round half up)', async () => {
    provider.queue({ base: USD, rateDate: TODAY, rates: { EUR: 0.85 } });
    // 1050 cents USD -> EUR: 1050 * 0.85 = 892.5 -> rounds to 893 (ties round half up).
    const result = await service.convert(1050, USD, EUR);
    expect(result).toEqual({ amount: 893, rateDate: TODAY });
    expect(provider.calls).toBe(1);
  });

  it("does not fetch again once today's rate is already cached", async () => {
    provider.queue({ base: USD, rateDate: TODAY, rates: { EUR: 0.85 } });
    await service.convert(100, USD, EUR);
    await service.convert(200, USD, EUR);
    expect(provider.calls).toBe(1);
  });

  it('falls back to the most recent cached rate when the fetch fails, honestly reporting its (older) date', async () => {
    model.seed({
      base: USD,
      rateDate: YESTERDAY,
      rates: { [EUR]: 0.9 },
      createdAt: new Date(Date.now() - 86_400_000),
    });
    provider.queue(new Error('FXRatesAPI is down'));

    const result = await service.convert(1000, USD, EUR);
    expect(result).toEqual({ amount: 900, rateDate: YESTERDAY });
    expect(errorLog).toHaveBeenCalled();
  });

  it('throws ServiceUnavailableException when the fetch fails and nothing is cached yet', async () => {
    provider.queue(new Error('FXRatesAPI is down'));
    await expect(service.convert(1000, USD, EUR)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('rejects an unsupported currency code before calling the provider', async () => {
    await expect(service.convert(1000, USD, 'ZZZ')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(provider.calls).toBe(0);
  });
});
