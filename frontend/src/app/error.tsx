'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { Alert } from '@/components/Alert';
import { PageHeader } from '@/components/PageHeader';
import { toFriendlyError } from '@/lib/apiError';

/**
 * #224: shown inside the normal header and footer when a page throws, for example when `serverApi` gets
 * a non-401 failure. A server error arrives with a generic message (Next hides the details), so it shows
 * the generic friendly text; an `ApiError` thrown in the browser keeps its own friendly message.
 * Try again re-fetches and re-renders the page (`retry`, Next 16.2+).
 */
export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const { message, hint, retryable } = toFriendlyError(error);
  return (
    <>
      <PageHeader title="Something went wrong" description="This page could not be shown." />
      <Alert variant="error" hint={hint} onRetry={retryable ? retry : undefined}>
        {message}
      </Alert>
      <p className="error-page-home">
        <Link className="btn" href="/">
          Back to home
        </Link>
      </p>
    </>
  );
}
