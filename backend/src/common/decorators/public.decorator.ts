import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Opens a route (or a whole controller) to guests: the global JwtAuthGuard skips it. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
