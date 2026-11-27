import type { Metadata } from 'next';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';

export const metadata: Metadata = { title: 'Page not found | Travel Planning and Booking Platform' };

/** #224: any address with no page, and any `notFound()` call, shows this inside the normal layout. */
export default function NotFound() {
  return (
    <>
      <PageHeader title="Page not found" description="The page you asked for does not exist or has moved." />
      <EmptyState
        icon="🧭"
        title="Nothing here"
        description="Check the address, or go back to the home page."
        action={{ label: 'Back to home', href: '/' }}
      />
    </>
  );
}
