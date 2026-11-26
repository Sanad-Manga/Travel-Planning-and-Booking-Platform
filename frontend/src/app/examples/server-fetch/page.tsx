import type { Metadata } from 'next';
import type { AuthUser } from '@/components/AuthProvider';
import { PageHeader } from '@/components/PageHeader';
import { serverApi } from '@/lib/serverApi';
import { ProfileSummary } from './ProfileSummary';
import { ProfileSummaryClient } from './ProfileSummaryClient';

export const metadata: Metadata = {
  title: 'Server fetch example | Travel Planning and Booking Platform',
  robots: { index: false },
};

/**
 * GEN-17 example: a server component that reads GET /api/auth/me with the user's forwarded cookie and
 * renders it in the first HTML. On a 401 (expired access token or a guest) it renders the client fallback,
 * which refreshes the session in the browser or sends the user to login. Copy this shape for real pages.
 */
export default async function ServerFetchExamplePage() {
  const me = await serverApi<AuthUser>('/api/auth/me');
  return (
    <>
      <PageHeader title="Server fetch example" description="Data loaded on the server, with a browser fallback when the session needs refreshing." />
      {me.ok ? <ProfileSummary user={me.data} source="server" /> : <ProfileSummaryClient />}
    </>
  );
}
