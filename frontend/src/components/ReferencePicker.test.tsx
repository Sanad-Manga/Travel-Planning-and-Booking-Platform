import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ReferencePicker } from './ReferencePicker';
import type { PickerOption } from './ReferencePicker';

const options: PickerOption[] = [
  { value: 'CAI', label: 'Cairo International Airport', detail: 'CAI · Cairo, Egypt' },
  { value: 'DXB', label: 'Dubai International Airport', detail: 'DXB · Dubai, United Arab Emirates' },
  { value: 'JFK', label: 'John F. Kennedy International Airport', detail: 'JFK · New York, United States' },
];

function Controlled(props: Partial<React.ComponentProps<typeof ReferencePicker>> & { onPick?: (v: string) => void }) {
  const [value, setValue] = useState(props.value ?? '');
  return (
    <ReferencePicker
      label="Airport"
      options={options}
      {...props}
      value={value}
      onChange={(v) => {
        setValue(v);
        props.onPick?.(v);
      }}
    />
  );
}

describe('ReferencePicker', () => {
  it('filters by label or detail as the user types, ignoring case', () => {
    render(<Controlled />);
    const input = screen.getByRole('combobox', { name: 'Airport' });
    fireEvent.change(input, { target: { value: 'dubai' } });
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([expect.stringContaining('Dubai International')]);
    fireEvent.change(input, { target: { value: 'jfk' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
  });

  it('selects with the keyboard and reports the code, then shows the chosen label', () => {
    const onPick = vi.fn();
    render(<Controlled onPick={onPick} />);
    const input = screen.getByRole('combobox', { name: 'Airport' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input).toHaveAttribute('aria-activedescendant', screen.getAllByRole('option')[1].id);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith('DXB');
    expect(input).toHaveValue('Dubai International Airport');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('selects with a click', () => {
    const onPick = vi.fn();
    render(<Controlled onPick={onPick} />);
    fireEvent.focus(screen.getByRole('combobox'));
    fireEvent.mouseDown(screen.getByRole('option', { name: /Kennedy/ }));
    expect(onPick).toHaveBeenCalledWith('JFK');
  });

  it('Escape closes the list and restores the chosen label', () => {
    render(<Controlled value="CAI" />);
    const input = screen.getByRole('combobox');
    expect(input).toHaveValue('Cairo International Airport');
    fireEvent.change(input, { target: { value: 'zzz' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input).toHaveValue('Cairo International Airport');
    expect(input).toHaveAttribute('aria-expanded', 'false');
  });

  it('says when nothing matches', () => {
    render(<Controlled />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'zzz' } });
    expect(screen.getByText('No matches for “zzz”.')).toBeInTheDocument();
  });

  it('shows the loading and error states and the field error', () => {
    const { rerender } = render(<ReferencePicker label="Airport" options={[]} value="" onChange={() => {}} isLoading />);
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    rerender(<ReferencePicker label="Airport" options={[]} value="" onChange={() => {}} loadError="Could not load the list." error="Choose an airport" />);
    expect(screen.getByText('Could not load the list.')).toBeInTheDocument();
    const input = screen.getByRole('combobox');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription(expect.stringContaining('Choose an airport'));
  });
});
