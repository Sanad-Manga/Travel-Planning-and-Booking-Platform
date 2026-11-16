import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PLATFORM_CURRENCY } from '../common';
import { FxService } from './fx.service';

/**
 * ITN-18: proactively keeps today's exchange rates cached, so the first real request of the day
 * does not have to wait on FXRatesAPI. `FxService.convert` does the same check lazily, so a
 * missed or delayed cron run never breaks conversion — it only means the lazy path fetches instead.
 */
@Injectable()
export class FxRateRefreshJob {
  private readonly logger = new Logger(FxRateRefreshJob.name);

  constructor(private readonly fx: FxService) {}

  // The cache day (ExchangeRate.rateDate) is a UTC calendar date; run at UTC midnight so the cron
  // and the lazy check in FxService.ensureTodaysRates always agree on what "today" means.
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, { timeZone: 'UTC' })
  async handleCron(): Promise<void> {
    try {
      await this.fx.ensureTodaysRates(PLATFORM_CURRENCY);
    } catch (error) {
      this.logger.error(
        'Daily FX rate refresh failed',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
