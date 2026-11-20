import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UploadsModule } from '../uploads';
import { AirlineLogoController } from './airline-logo.controller';
import { AirlineLogoService } from './airline-logo.service';
import { AirlinesController } from './airlines.controller';
import { AirlinesService } from './airlines.service';
import { Airline, AirlineSchema } from './schemas/airline.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Airline.name, schema: AirlineSchema }]),
    UploadsModule, // GEN-08: airline logo
  ],
  controllers: [AirlinesController, AirlineLogoController],
  providers: [AirlinesService, AirlineLogoService],
  // Other modules (flights, admin, search) look airlines up through the service, never the model.
  exports: [AirlinesService],
})
export class AirlinesModule {}
