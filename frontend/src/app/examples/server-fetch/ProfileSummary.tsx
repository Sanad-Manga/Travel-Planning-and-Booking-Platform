import type { AuthUser } from '@/components/AuthProvider';
import { Card } from '@/components/Card';

/** GEN-17 example: plain markup, usable from both the server page and the client fallback. */
export function ProfileSummary({ user, source }: { user: AuthUser; source: 'server' | 'browser' }) {
  return (
    <Card title="Signed in as">
      <p>
        <strong>{user.name}</strong>
      </p>
      <p>{user.email}</p>
      <p className="field-hint">{source === 'server' ? 'Loaded on the server.' : 'Loaded in the browser.'}</p>
    </Card>
  );
}
