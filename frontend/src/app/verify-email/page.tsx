import type { Metadata } from 'next';
import { PageHeader } from '@/components/PageHeader';
import { VerifyEmail } from '@/features/account/VerifyEmail';

export const metadata: Metadata = {
  title: 'Verify email | Travel Planning and Booking Platform',
  robots: { index: false },
};

/** ACC-02: opened from the verification email, /verify-email?token=... */
export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token } = await searchParams;
  return (
    <>
      <PageHeader title="Verify your email" />
      <VerifyEmail token={typeof token === 'string' ? token : ''} />
    </>
  );
}
