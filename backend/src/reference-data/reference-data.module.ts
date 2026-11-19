import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { referenceModelDefinitions } from './reference-data.models';
import { ReferenceDataService } from './reference-data.service';
import { AirportsController } from './airports.controller';
import { ReferenceLookupsController } from './reference-lookups.controller';

@Module({
  imports: [MongooseModule.forFeature(referenceModelDefinitions)],
  controllers: [AirportsController, ReferenceLookupsController],
  providers: [ReferenceDataService],
  exports: [ReferenceDataService],
})
export class ReferenceDataModule {}
