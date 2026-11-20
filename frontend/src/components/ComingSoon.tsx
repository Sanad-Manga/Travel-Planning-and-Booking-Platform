import { Breadcrumbs } from './Breadcrumbs';
import { EmptyState } from './EmptyState';
import { PageHeader } from './PageHeader';

/** GEN-14: stand-in for a page whose feature is not built yet, so no navigation link ends in a 404. */
export function ComingSoon({ title, description }: { title: string; description?: string }) {
  return (
    <>
      <Breadcrumbs items={[{ label: 'Home', href: '/' }, { label: title }]} />
      <PageHeader title={title} description={description ?? 'We are still building this page.'} />
      <EmptyState
        icon="🚧"
        title="Coming soon"
        description="Check back shortly."
        action={{ label: 'Back to home', href: '/' }}
      />
    </>
  );
}
