'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Alert } from '@/components/Alert';
import { useAuth } from '@/components/AuthProvider';
import { ApiError, api } from '@/lib/api';
import { toFriendlyError } from '@/lib/apiError';
import { ResendVerification } from './ResendVerification';

type Outcome =
  | { kind: 'checking' }
  | { kind: 'verified'; already: boolean }
  | { kind: 'invalid' }
  | { kind: 'failed'; message: string; hint: string };

function isInvalidLink(error: unknown): boolean {
  return error instanceof ApiError && error.statusCode === 400 && error.details.some((d) => d.field === 'token');
}

/**
 * ACC-02: the page the verification email links to (/verify-email?token=...). It sends the token to
 * GET /api/auth/verify-email exactly once (the token is single use, so React StrictMode's second effect
 * must not send it again) and shows one of: verified, already verified, invalid or expired (with a way to
 * get a new link), or a network/server error with Try again.
 */
export function VerifyEmail({ token }: { token: string }) {
  const { user, loading, refresh } = useAuth();
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'checking' });
  const [attempt, setAttempt] = useState(0);
  const request = useRef<{ key: string; promise: Promise<{ message: string }> } | null>(null);

  useEffect(() => {
    if (!token) return;
    const key = `${attempt}:${token}`;
    if (request.current?.key !== key) {
      request.current = { key, promise: api<{ message: string }>(`/auth/verify-email?token=${encodeURIComponent(token)}`) };
    }
    let active = true;
    request.current.promise.then(
      ({ message }) => {
        if (!active) return;
        setOutcome({ kind: 'verified', already: message === 'Email already verified' });
        void refresh();
      },
      (error: unknown) => {
        if (!active) return;
        if (isInvalidLink(error)) {
          setOutcome({ kind: 'invalid' });
          return;
        }
        const friendly = toFriendlyError(error);
        setOutcome({ kind: 'failed', message: friendly.message, hint: friendly.hint });
      },
    );
    return () => {
      active = false;
    };
  }, [token, attempt, refresh]);

  function tryAgain() {
    setOutcome({ kind: 'checking' });
    setAttempt((n) => n + 1);
  }

  // Until the session check answers we do not know which of the two to offer, so offer neither yet.
  const getNewLink = loading ? null : user ? (
    <ResendVerification />
  ) : (
    <p>
      <Link href="/login">Log in</Link> to get a new link.
    </p>
  );

  if (!token) {
    return (
      <Alert variant="warning" title="This link is incomplete.">
        <p>Open the link from the email again, or ask for a new one.</p>
        {getNewLink}
      </Alert>
    );
  }
  if (outcome.kind === 'checking') {
    return (
      <p className="field-hint" role="status">
        Checking your link…
      </p>
    );
  }
  if (outcome.kind === 'verified') {
    return (
      <Alert variant="success" title={outcome.already ? 'Your email was already verified.' : 'Your email is verified.'}>
        <p>You can now book flights and hotels.</p>
        <p>
          <Link className="btn btn-primary" href="/">
            Continue
          </Link>
        </p>
      </Alert>
    );
  }
  if (outcome.kind === 'invalid') {
    return (
      <Alert variant="error" title="This link is invalid or has expired.">
        <p>A link works once, for 24 hours, and a newer link replaces older ones.</p>
        {getNewLink}
      </Alert>
    );
  }
  return (
    <Alert variant="error" title={outcome.message} hint={outcome.hint} onRetry={tryAgain}>
      Your email could not be verified yet.
    </Alert>
  );
}
