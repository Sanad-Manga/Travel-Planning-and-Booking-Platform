import { useId } from 'react';
import type { SelectHTMLAttributes } from 'react';

export interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> {
  /** Always visible. A placeholder option is not a label. */
  label: string;
  /** Help shown under the field. */
  hint?: string;
  /** Field-level error. Shown under the field and marks it invalid. */
  error?: string;
}

/** GEN-17: a labelled dropdown, styled and announced like TextField. */
export function SelectField({ label, hint, error, required, className, children, ...select }: SelectFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
        {required ? (
          <span className="field-required" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      {hint ? (
        <p id={hintId} className="field-hint">
          {hint}
        </p>
      ) : null}
      <select
        {...select}
        id={id}
        required={required}
        className={['field-input', className].filter(Boolean).join(' ')}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
      >
        {children}
      </select>
      {error ? (
        <p id={errorId} className="field-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
