'use client';

import { useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { api } from '@/lib/api';
import { toFriendlyError } from '@/lib/apiError';

type State = { kind: 'idle' } | { kind: 'sending' } | { kind: 'sent' } | { kind: 'verified' } | { kind: 'error'; text: string };

/**
 * ACC-02: "Send a new link" for a signed-in user whose email is not verified (POST /api/auth/resend-verification).
 * The outcome is shown next to the button: sent (with the address), already verified, or the friendly error
 * (a 429 says how many seconds to wait).
 */
export function ResendVerification() {
  const { user, refresh } = useAuth();
  const [state, setState] = useState<State>({ kind: 'idle' });

  async function resend() {
    setState({ kind: 'sending' });
    try {
      const { message } = await api<{ message: string }>('/auth/resend-verification', { method: 'POST' });
      if (message === 'Email already verified') {
        setState({ kind: 'verified' });
        await refresh();
      } else {
        setState({ kind: 'sent' });
      }
    } catch (error) {
      const friendly = toFriendlyError(error);
      setState({ kind: 'error', text: `${friendly.message} ${friendly.hint}` });
    }
  }

  const result =
    state.kind === 'sent'
      ? `We sent a new link to ${user?.email ?? 'your email address'}. It works for 24 hours.`
      : state.kind === 'verified'
        ? 'Your email is already verified.'
        : state.kind === 'error'
          ? state.text
          : null;

  return (
    <div className="resend-verification">
      <button type="button" className="btn btn-sm" onClick={() => void resend()} disabled={state.kind === 'sending'}>
        {state.kind === 'sending' ? 'Sending…' : 'Send a new link'}
      </button>
      <p className="resend-verification-result" role={state.kind === 'error' ? 'alert' : 'status'}>
        {result}
      </p>
    </div>
  );
}
