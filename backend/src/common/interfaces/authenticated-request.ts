import { Request } from 'express';
import { AuthenticatedUser } from './authenticated-user';

/** An Express request after JwtAuthGuard has run: `user` is the authenticated principal. */
export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}
