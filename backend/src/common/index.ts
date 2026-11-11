// Single import point for shared code: `import { Role, paginate, PaginationDto } from '../common';`
export * from './enums';
export * from './constants';
export * from './filters';
export * from './pagination';
export * from './pipes';
export * from './local-time';
export * from './interfaces/authenticated-user';
export * from './interfaces/authenticated-request';
export * from './interfaces/access-token-payload';
// Auth: JwtAuthGuard and RolesGuard are global; use @Public() to open a route, @Roles(...) to restrict, @CurrentUser() for the principal.
export * from './decorators';
export * from './guards';
