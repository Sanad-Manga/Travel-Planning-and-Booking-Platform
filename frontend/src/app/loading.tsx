import { Spinner } from '@/components/Spinner';

/** #224: shown while a server-rendered page is loading, inside the normal header and footer. */
export default function Loading() {
  return (
    <div className="page-loading">
      <Spinner label="Loading page" />
    </div>
  );
}
