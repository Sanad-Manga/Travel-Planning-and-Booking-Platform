import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ACCESS_TOKEN_COOKIE } from '../constants';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ALLOW_WHEN_MUST_CHANGE } from '../decorators/allow-when-must-change.decorator';
import { Role } from '../enums';
import { AccessTokenPayload, readTokenVersion } from '../interfaces/access-token-payload';
import { AuthenticatedRequest } from '../interfaces/authenticated-request';
import { ACCOUNT_STATUS_CHECKER, AccountStatusChecker } from './account-status';

/**
 * Global guard (registered once with APP_GUARD in AuthModule). Every route needs a valid access-token
 * cookie unless it is marked @Public(). The role and ids come from the signed claims, but the account must
 * also still be ACTIVE at the same credential version. One lookup also reads forced-change state;
 * only explicitly marked replacement/session handlers are allowed while forced. (A role change takes effect at the next
 * login or refresh.)
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
    @Inject(ACCOUNT_STATUS_CHECKER) private readonly accounts: AccountStatusChecker,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token: unknown = request.cookies?.[ACCESS_TOKEN_COOKIE];
    if (typeof token !== 'string' || token === '') {
      throw new UnauthorizedException('Authentication required');
    }

    let payload: AccessTokenPayload;
    try {
      // Checks the signature and the expiry using the secret configured in JwtModule.
      payload = await this.jwtService.verifyAsync<AccessTokenPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    // A correctly signed token with unexpected claims is still rejected.
    if (!payload || typeof payload.sub !== 'string' || !Object.values(Role).includes(payload.role)) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    // Fails closed: a missing, suspended or deactivated account is a 401, and a failed lookup is a 500, never a pass.
    const version = readTokenVersion(payload.tokenVersion);
    const state = await this.accounts.getAuthenticationState(payload.sub);
    if (!state?.active || version === null || version !== state.tokenVersion) {
      throw new UnauthorizedException('Authentication required');
    }

    if (state.mustChangePassword && !this.reflector.getAllAndOverride<boolean>(ALLOW_WHEN_MUST_CHANGE, [context.getHandler(), context.getClass()])) {
      throw new ForbiddenException('Password replacement required');
    }

    request.user = {
      userId: payload.sub,
      tokenVersion: version,
      role: payload.role,
      ...(payload.airlineId ? { airlineId: payload.airlineId } : {}),
      ...(payload.hotelId ? { hotelId: payload.hotelId } : {}),
    };
    return true;
  }
}
