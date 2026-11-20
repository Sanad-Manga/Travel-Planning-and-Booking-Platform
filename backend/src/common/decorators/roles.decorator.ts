import { SetMetadata } from '@nestjs/common';
import { Role } from '../enums';

export const ROLES_KEY = 'roles';

/** Restricts a route to the listed roles, e.g. `@Roles(Role.ADMIN)`. Checked by RolesGuard (403 otherwise). */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
