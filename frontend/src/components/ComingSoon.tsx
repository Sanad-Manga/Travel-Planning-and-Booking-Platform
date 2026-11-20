import { EmptyState } from './EmptyState';

/** GEN-14: stand-in for a page whose feature is not built yet, so no navigation link ends in a 404. */
export function ComingSoon({ title }: { title: string }) {
  return (
    <>
      <h1>{title}</h1>
      <EmptyState
        icon="🚧"
        title="Coming soon"
        description="We are still building this page. Check back shortly."
        action={{ label: 'Back to home', href: '/' }}
      />
    </>
  );
}
