import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { ReferenceDataModule } from '../reference-data/reference-data.module';
import {
  EXCHANGE_RATE_PROVIDER,
  HttpExchangeRateProvider,
} from './exchange-rate-provider';
import { FxRateRefreshJob } from './fx-rate-refresh.job';
import { FxService } from './fx.service';
import {
  ExchangeRate,
  ExchangeRateSchema,
} from './schemas/exchange-rate.schema';

// ScheduleModule.forRoot() is harmless if another module also imports it (Nest dedupes it).
@Module({
  imports: [
    ScheduleModule.forRoot(),
    MongooseModule.forFeature([
      { name: ExchangeRate.name, schema: ExchangeRateSchema },
    ]),
    ReferenceDataModule,
  ],
  providers: [
    FxService,
    FxRateRefreshJob,
    { provide: EXCHANGE_RATE_PROVIDER, useClass: HttpExchangeRateProvider },
  ],
  exports: [FxService],
})
export class FxModule {}
