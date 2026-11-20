export interface SkeletonProps {
  width?: string;
  height?: string;
  /** Render this many text-like lines (the last one shorter) instead of one block. */
  lines?: number;
}

/**
 * GEN-16: a grey placeholder shaped like the content that is about to load, so lists and cards do not
 * jump when data arrives. Purely decorative: pair it with a Spinner (or an aria-busy region) so the
 * loading state is announced.
 */
export function Skeleton({ width, height, lines }: SkeletonProps) {
  if (lines && lines > 1) {
    return (
      <div className="skeleton-lines" aria-hidden="true">
        {Array.from({ length: lines }, (_, index) => (
          <div
            key={index}
            className="skeleton"
            style={{ width: index === lines - 1 ? '60%' : width, height }}
          />
        ))}
      </div>
    );
  }
  return <div className="skeleton" aria-hidden="true" style={{ width, height }} />;
}
