import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ACCOUNT_STATUS_CHECKER, JwtAuthGuard, RolesGuard } from '../common';
import { UsersModule } from '../users/users.module';
import { UsersService } from '../users/users.service';
import { ACCESS_TOKEN_TTL_SECONDS } from './auth-cookies';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { readJwtSecrets } from './jwt-secrets';

@Module({
  imports: [
    UsersModule,
    // The factory runs at start-up: readJwtSecrets throws if a secret is missing or shorter than 32 characters.
    // The module-level secret is the ACCESS secret; refresh tokens will pass their own secret explicitly.
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: readJwtSecrets(config).access,
        signOptions: { algorithm: 'HS256', expiresIn: ACCESS_TOKEN_TTL_SECONDS },
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    // What JwtAuthGuard uses to confirm the account is still ACTIVE on every request (UsersService.isActive).
    { provide: ACCOUNT_STATUS_CHECKER, useExisting: UsersService },
    // Global guards run in the order they are listed here: first authenticate, then check the role.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AuthModule {}
