import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoginForm } from '@/components/LoginForm';
import { Spinner } from '@/components/Spinner';

export const metadata: Metadata = { title: 'Login | Travel Planning and Booking Platform' };

export default function LoginPage() {
  // useSearchParams (for returnTo) needs a Suspense boundary in the App Router.
  return (
    <Suspense fallback={<Spinner />}>
      <LoginForm />
    </Suspense>
  );
}
