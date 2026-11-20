import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedRequest } from '../interfaces/authenticated-request';
import { AuthenticatedUser } from '../interfaces/authenticated-user';

/**
 * Injects the logged-in principal `{ userId, role, airlineId?, hotelId? }` into a handler:
 * `me(@CurrentUser() user: AuthenticatedUser)`. Only meaningful on routes that are not @Public().
 */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
  const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
  return request.user as AuthenticatedUser;
});
