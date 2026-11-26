'use client';

import { useId, useMemo, useState } from 'react';
import type { KeyboardEvent } from 'react';

export interface PickerOption {
  /** What the form stores and sends to the API (IATA code, country code, city id, currency code). */
  value: string;
  /** What the user reads and searches. */
  label: string;
  /** Optional second line, also searched (for example "CAI · Cairo, Egypt"). */
  detail?: string;
}

export interface ReferencePickerProps {
  label: string;
  options: PickerOption[];
  /** The selected option's value, or '' for none. */
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  /** Field-level error from the API's `details[]` or from client checks. */
  error?: string;
  /** The list is still loading. */
  isLoading?: boolean;
  /** The list could not be loaded: one plain sentence. */
  loadError?: string;
  /** A note under the field, for example that the list is incomplete. */
  notice?: string;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  /** Form field name for a hidden input carrying the value, for plain HTML forms. */
  name?: string;
}

/** Most options rendered at once; typing narrows the list further. */
const MAX_SHOWN = 50;

/**
 * FLT-02 / GEN-12: a searchable dropdown (ARIA 1.2 combobox with a listbox). The user types to filter by name,
 * code or detail, picks with the mouse or with Arrow keys + Enter, and Escape cancels. The form only ever
 * receives an option's `value`, never the typed text. Emptying the text and leaving the field (or pressing Enter)
 * clears the value with `onChange('')`; an optional field with a value also shows a Clear button.
 */
export function ReferencePicker({
  label,
  options,
  value,
  onChange,
  hint,
  error,
  isLoading,
  loadError,
  notice,
  required,
  disabled,
  placeholder,
  name,
}: ReferencePickerProps) {
  const id = useId();
  const listId = `${id}-list`;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const statusId = `${id}-status`;
  const noticeId = `${id}-notice`;

  // null = not typing: the input shows the selected option's label.
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const selected = options.find((o) => o.value === value);
  const shown = useMemo(() => {
    const text = (query ?? '').trim().toLowerCase();
    const matches = text
      ? options.filter((o) => [o.label, o.detail ?? '', o.value].some((s) => s.toLowerCase().includes(text)))
      : options;
    return matches.slice(0, MAX_SHOWN);
  }, [options, query]);

  const close = () => {
    setOpen(false);
    setActive(-1);
    setQuery(null);
  };

  const choose = (option: PickerOption) => {
    onChange(option.value);
    close();
  };

  const clear = () => {
    if (value !== '') onChange('');
    close();
  };

  /** The user deleted the text: leaving the field (or Enter) means "no value", not "keep the old one". */
  const emptied = query !== null && query.trim() === '';

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setActive(shown.length ? 0 : -1);
        return;
      }
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (shown.length ? (i + step + shown.length) % shown.length : -1));
    } else if (event.key === 'Enter' && open && active >= 0 && shown[active]) {
      event.preventDefault();
      choose(shown[active]);
    } else if (event.key === 'Enter' && emptied) {
      event.preventDefault();
      clear();
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      close();
    }
  };

  const describedBy =
    [hint ? hintId : null, isLoading || loadError ? statusId : null, notice ? noticeId : null, error ? errorId : null]
      .filter(Boolean)
      .join(' ') ||
    undefined;
  const activeId = open && active >= 0 && shown[active] ? `${id}-opt-${active}` : undefined;
  const typed = (query ?? '').trim();

  return (
    <div className="field picker">
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
      <div className="picker-control">
        <input
          id={id}
          type="text"
          role="combobox"
          className="field-input"
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={activeId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          aria-busy={isLoading ? true : undefined}
          required={required}
          disabled={disabled}
          placeholder={placeholder ?? 'Type to search'}
          value={query ?? selected?.label ?? ''}
          onFocus={() => setOpen(true)}
          onBlur={() => (emptied ? clear() : close())}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onKeyDown={onKeyDown}
        />
        {!required && !disabled && value ? (
          <button type="button" className="picker-clear" aria-label={`Clear ${label}`} onClick={clear}>
            ×
          </button>
        ) : null}
        {name ? <input type="hidden" name={name} value={value} /> : null}
        {open && !isLoading && !loadError ? (
          <div className="picker-popup">
            {shown.length ? (
              <ul id={listId} role="listbox" aria-label={label} className="picker-list">
                {shown.map((option, index) => (
                  <li
                    key={option.value}
                    id={`${id}-opt-${index}`}
                    role="option"
                    aria-selected={option.value === value}
                    className={['picker-option', index === active ? 'is-active' : ''].filter(Boolean).join(' ')}
                    // mousedown, not click: it fires before the input's blur closes the list.
                    onMouseDown={(event) => {
                      event.preventDefault();
                      choose(option);
                    }}
                  >
                    <span className="picker-option-label">{option.label}</span>
                    {option.detail ? <span className="picker-option-detail">{option.detail}</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="picker-empty" role="status">
                {typed ? `No matches for “${typed}”.` : 'Nothing to choose from yet.'}
              </p>
            )}
          </div>
        ) : null}
      </div>
      {isLoading ? (
        <p id={statusId} className="field-hint" role="status">
          Loading…
        </p>
      ) : loadError ? (
        <p id={statusId} className="field-error" role="alert">
          {loadError}
        </p>
      ) : null}
      {notice ? (
        <p id={noticeId} className="field-hint">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="field-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
