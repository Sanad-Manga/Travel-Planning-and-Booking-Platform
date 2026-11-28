import { Alert } from '@/components/Alert';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { Skeleton } from '@/components/Skeleton';
import type { Overview } from './dashboardData';
import styles from './admin.module.css';

const statistics = [
  { key: 'accounts', label: 'Total accounts' },
  { key: 'airlines', label: 'Airlines' },
  { key: 'hotels', label: 'Hotels' },
] as const;
const format = new Intl.NumberFormat('en-US');

export function AdminDashboard({ name, totals, pending, retry }: {
  name: string;
  totals: Overview;
  pending?: boolean;
  retry: () => void;
}) {
  const unavailable = Object.values(totals).includes('unavailable');
  const empty = Object.values(totals).every((value) => value === 0);

  return (
    <div className={styles.dashboard}>
      <PageHeader title="Admin dashboard" description={`Welcome, ${name}.`} />
      <section aria-labelledby="admin-overview-title" aria-busy={pending || undefined}>
        <h2 id="admin-overview-title" className={styles.overviewHeading}>Platform overview</h2>
        <div className={styles.statistics}>
          {statistics.map(({ key, label }) => {
            const value = totals[key];
            return (
              <Card key={key} title={label} headingLevel={3}>
                {value === 'loading' ? <div role="status" aria-label={`Loading ${label.toLowerCase()}`}><Skeleton /></div>
                  : value === 'unavailable' ? <p className="field-hint">Unavailable</p>
                  : <p className={styles.total}>{format.format(value)}</p>}
              </Card>
            );
          })}
        </div>
      </section>
      {empty && <EmptyState title="No records yet" />}
      {unavailable && !pending && (
        <Alert variant="error" onRetry={retry}>Some dashboard totals could not be loaded.</Alert>
      )}
      {pending && <p className="field-hint" role="status">Refreshing dashboard…</p>}
    </div>
  );
}
