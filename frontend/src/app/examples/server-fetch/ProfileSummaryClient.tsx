'use client';

import { useApi } from '@/api/useApi';
import { Alert } from '@/components/Alert';
import type { AuthUser } from '@/components/AuthProvider';
import { Skeleton } from '@/components/Skeleton';
import { toFriendlyError } from '@/lib/apiError';
import { ProfileSummary } from './ProfileSummary';

/**
 * GEN-17 client-side fallback: the server got a 401, so load the same data in the browser. `api()` refreshes
 * the session once; if the user really is logged out it sends them to /login?returnTo=<this page>.
 */
export function ProfileSummaryClient() {
  const { data, error, isLoading, mutate } = useApi<AuthUser>('/api/auth/me');
  if (isLoading) return <Skeleton lines={3} />;
  if (error) {
    const friendly = toFriendlyError(error);
    return (
      <Alert variant="error" title={friendly.message} hint={friendly.hint} onRetry={() => void mutate()}>
        Your profile could not be loaded.
      </Alert>
    );
  }
  return data ? <ProfileSummary user={data} source="browser" /> : null;
}
