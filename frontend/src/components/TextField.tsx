import { useId } from 'react';
import type { InputHTMLAttributes } from 'react';

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  /** Always visible. Placeholders are not labels. */
  label: string;
  /** Help shown under the field. */
  hint?: string;
  /** Field-level error from the API's `details[]` or from client checks. Shown under the field. */
  error?: string;
}

/**
 * GEN-17: a labelled text input. The label is tied to the input, the hint and the error are announced
 * with it (aria-describedby), and an error also sets aria-invalid so the field is styled and read out as invalid.
 */
export function TextField({ label, hint, error, required, className, ...input }: TextFieldProps) {
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
      <input
        {...input}
        id={id}
        required={required}
        className={['field-input', className].filter(Boolean).join(' ')}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
      />
      {error ? (
        <p id={errorId} className="field-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
