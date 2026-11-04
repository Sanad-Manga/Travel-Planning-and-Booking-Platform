import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { referenceModelDefinitions } from './reference-data.models';
import { ReferenceDataService } from './reference-data.service';

@Module({
  imports: [MongooseModule.forFeature(referenceModelDefinitions)],
  providers: [ReferenceDataService],
  exports: [ReferenceDataService],
})
export class ReferenceDataModule {}
