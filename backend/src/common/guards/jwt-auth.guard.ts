import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ACCESS_TOKEN_COOKIE } from '../constants';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { Role } from '../enums';
import { AccessTokenPayload } from '../interfaces/access-token-payload';
import { AuthenticatedRequest } from '../interfaces/authenticated-request';
import { ACCOUNT_STATUS_CHECKER, AccountStatusChecker } from './account-status';

/**
 * Global guard (registered once with APP_GUARD in AuthModule). Every route needs a valid access-token
 * cookie unless it is marked @Public(). The role and ids come from the signed claims, but the account must
 * also still be ACTIVE: one lookup by id per request, so a suspended or deactivated user is locked out
 * immediately instead of when the 15-minute token expires. (A role change still takes effect at the next
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
    if (typeof payload.sub !== 'string' || !Object.values(Role).includes(payload.role)) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    // Fails closed: a missing, suspended or deactivated account is a 401, and a failed lookup is a 500, never a pass.
    if (!(await this.accounts.isActive(payload.sub))) {
      throw new UnauthorizedException('Authentication required');
    }

    request.user = {
      userId: payload.sub,
      role: payload.role,
      ...(payload.airlineId ? { airlineId: payload.airlineId } : {}),
      ...(payload.hotelId ? { hotelId: payload.hotelId } : {}),
    };
    return true;
  }
}
