import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { referenceModelDefinitions } from './reference-data.models';
import { ReferenceDataService } from './reference-data.service';
import { AirportsController } from './airports.controller';
import {
  CitiesController,
  CountriesController,
  CurrenciesController,
} from './reference-lookups.controller';

@Module({
  imports: [MongooseModule.forFeature(referenceModelDefinitions)],
  controllers: [
    AirportsController,
    CountriesController,
    CitiesController,
    CurrenciesController,
  ],
  providers: [ReferenceDataService],
  exports: [ReferenceDataService],
})
export class ReferenceDataModule {}
