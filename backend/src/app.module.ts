import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AirlinesModule } from './airlines';
import { AuthModule } from './auth/auth.module';
import configuration from './config/configuration';
import { validateEnv } from './config/env.validation';
import { NotificationsModule } from './notifications';
import { PaymentsModule } from './payments';

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
    AuthModule,
    NotificationsModule,
    AirlinesModule,
  ],
})
export class AppModule {}
