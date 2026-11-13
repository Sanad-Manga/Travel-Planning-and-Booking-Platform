import { Module } from '@nestjs/common';
import { AdminModule } from './admin/admin.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AirlinesModule } from './airlines';
import { AuditModule } from './audit';
import { AuthModule } from './auth/auth.module';
import { BlogModule } from './blog/blog.module';
import configuration from './config/configuration';
import { validateEnv } from './config/env.validation';
import { FlightsModule } from './flights';
import { ItinerariesModule } from './itineraries';
import { NotificationsModule } from './notifications';
import { HotelsModule } from './hotels/hotels.module';
import { PaymentsModule } from './payments';
import { ReferenceDataModule } from './reference-data/reference-data.module';
import { ReportsModule } from './reports';
import { UploadsModule } from './uploads';

// Feature modules (auth, flights, hotels, ...) are added here by their owners in their own PRs.
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'],
      load: [configuration],
      validate: validateEnv,
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({ uri: config.getOrThrow<string>('MONGODB_URI') }),
    }),
    PaymentsModule,
    BlogModule,
    AuthModule,
    NotificationsModule,
    HotelsModule,
    ReferenceDataModule,
    AirlinesModule,
    FlightsModule,
    ItinerariesModule,
    AuditModule,
    UploadsModule,
    ReportsModule,
    AdminModule,
  ],
})
export class AppModule {}
