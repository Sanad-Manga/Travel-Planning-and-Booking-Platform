import { applyDecorators, CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ApiForbiddenResponse } from '@nestjs/swagger';
import { AuthenticatedRequest, ErrorResponseDto } from '../common';
import { UsersService } from '../users/users.service';

export const EMAIL_NOT_VERIFIED_MESSAGE = 'Verify your email before booking';

/**
 * ACC-02: blocks a logged-in user whose email is explicitly unverified (`emailVerified === false`).
 * Users without the field (existing, seeded, admin-created) count as verified.
 *
 * Needs nothing from the host module: only ModuleRef, which Nest provides to every module. UsersService is looked up
 * lazily (non-strict) because the global JwtAuthGuard principal does not carry emailVerified and `common/` is not ours to change.
 * Global guards run first, so a guest already got 401; an absent principal is also a 401 here.
 */
@Injectable()
export class RequireVerifiedEmailGuard implements CanActivate {
  constructor(private readonly moduleRef: ModuleRef) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const principal = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
    if (!principal) throw new UnauthorizedException('Authentication required');

    // Fails closed: a failed lookup rejects (500) instead of letting an unverified user through.
    const users = this.moduleRef.get(UsersService, { strict: false });
    if (await users.isEmailUnverified(principal.userId)) {
      throw new ForbiddenException({
        message: EMAIL_NOT_VERIFIED_MESSAGE,
        details: [{ field: 'emailVerified', message: 'EMAIL_NOT_VERIFIED' }],
      });
    }
    return true;
  }
}

/** Put on a booking-creation route: `@RequireVerifiedEmail()`. */
export const RequireVerifiedEmail = () =>
  applyDecorators(
    UseGuards(RequireVerifiedEmailGuard),
    ApiForbiddenResponse({ type: ErrorResponseDto, description: `${EMAIL_NOT_VERIFIED_MESSAGE} (details[0].message = EMAIL_NOT_VERIFIED)` }),
  );
