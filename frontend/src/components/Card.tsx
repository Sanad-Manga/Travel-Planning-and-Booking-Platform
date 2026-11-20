import type { ReactNode } from 'react';

export interface CardProps {
  title?: string;
  /** Heading level for the title (default 2). */
  headingLevel?: 2 | 3 | 4;
  children: ReactNode;
}

/** GEN-17: the one container style for grouped content (bookings, results, summaries). */
export function Card({ title, headingLevel = 2, children }: CardProps) {
  const Heading = `h${headingLevel}` as const;
  return (
    <section className="card">
      {title ? <Heading className="card-title">{title}</Heading> : null}
      {children}
    </section>
  );
}
