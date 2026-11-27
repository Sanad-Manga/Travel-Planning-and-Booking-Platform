'use client';

import './globals.css';

/**
 * #224: last resort when the root layout itself fails. It replaces the whole document, so it has its own
 * <html> and <body> and loads the theme stylesheet; the providers, header and footer are not available.
 */
export default function GlobalError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="en">
      <body>
        <title>Something went wrong | Travel Planning and Booking Platform</title>
        <main className="global-error">
          <h1>Something went wrong</h1>
          <p>The site could not load. Please try again. If it keeps happening, contact support.</p>
          <button type="button" className="btn btn-primary" onClick={() => retry()}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
