import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthenticatedUser } from '../common';

/**
 * TEMPORARY stand-in for `@CurrentUser()` from common/ (Auth ticket SCRUM-15, not merged yet).
 * It reads the principal that the auth guard puts on `request.user` and answers 401 when there is none.
 * When SCRUM-15 is on develop: delete this file and import CurrentUser from '../common' instead.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const user = ctx
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>().user;
    if (!user) throw new UnauthorizedException('Authentication required');
    return user;
  },
);
