import Link from 'next/link';
import type { ReactNode } from 'react';

export interface EmptyStateAction {
  label: string;
  /** A page to go to. Give either `href` or `onClick`. */
  href?: string;
  onClick?: () => void;
}

export interface EmptyStateProps {
  /** What is empty, in plain words: "No bookings yet". */
  title: string;
  /** What to do about it, or why it is empty: "Search for a flight to make your first booking." */
  description?: ReactNode;
  /** A small decorative symbol (an emoji or an icon). Hidden from screen readers. */
  icon?: ReactNode;
  /** The one next step, as a button or link. */
  action?: EmptyStateAction;
  /** Heading level for the title (default 2, so it sits under the page's h1). */
  headingLevel?: 2 | 3 | 4;
}

/**
 * GEN-04: what a list shows when it has nothing to list. Never a blank gap and never a bare "[]":
 * a short title that says what is empty, a sentence that says what to do next, and at most one action.
 * Announced politely to screen readers (role="status").
 */
export function EmptyState({ title, description, icon, action, headingLevel = 2 }: EmptyStateProps) {
  const Heading = `h${headingLevel}` as const;
  return (
    <section role="status" className="empty-state">
      {icon ? (
        <div className="empty-state-icon" aria-hidden="true">
          {icon}
        </div>
      ) : null}
      <Heading className="empty-state-title">{title}</Heading>
      {description ? <p className="empty-state-description">{description}</p> : null}
      {action ? (
        action.href ? (
          <Link className="btn btn-primary" href={action.href}>
            {action.label}
          </Link>
        ) : (
          <button type="button" className="btn btn-primary" onClick={action.onClick}>
            {action.label}
          </button>
        )
      ) : null}
    </section>
  );
}
