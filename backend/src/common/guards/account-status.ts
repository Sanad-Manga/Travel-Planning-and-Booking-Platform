/**
 * How the global JwtAuthGuard asks "is this account still allowed in?" without `common/` depending on
 * the users module. AuthModule provides the real one (UsersService); tests can provide a fake.
 */
export const ACCOUNT_STATUS_CHECKER = Symbol('ACCOUNT_STATUS_CHECKER');

export interface AccountStatusChecker {
  /** One indexed read of status/version/forced state; lookup failures reject rather than allow access. */
  getAuthenticationState(userId: string): Promise<{ active: boolean; tokenVersion: number; mustChangePassword: boolean } | null>;
  /** True only if the user exists and its status is ACTIVE. Rejects (does not return false) if the lookup itself fails. */
  isActive(userId: string): Promise<boolean>;
}
