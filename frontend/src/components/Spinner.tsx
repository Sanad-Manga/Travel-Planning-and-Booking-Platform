export interface SpinnerProps {
  /** What is loading, read out by screen readers: "Searching flights". */
  label?: string;
  size?: 'sm' | 'md';
}

/** GEN-16: shows that something is in progress. The label is for screen readers only. */
export function Spinner({ label = 'Loading', size = 'md' }: SpinnerProps) {
  return (
    <span role="status" className="spinner-wrap">
      <span className={size === 'sm' ? 'spinner spinner-sm' : 'spinner'} aria-hidden="true" />
      <span className="visually-hidden">{label}</span>
    </span>
  );
}
