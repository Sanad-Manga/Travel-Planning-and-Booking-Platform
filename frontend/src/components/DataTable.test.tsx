import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DataTable, type TableColumn } from './DataTable';

const rows = [{ id: 'a', name: 'Cairo' }, { id: 'b', name: 'Oslo' }];
const columns: TableColumn<(typeof rows)[number]>[] = [
  { id: 'place', header: 'City', cell: (row) => row.name },
  { id: 'note', header: 'Note', cell: (row) => <input aria-label={`Note for ${row.name}`} /> },
];
const props = { caption: 'Cities', rows, columns, rowKey: (row: (typeof rows)[number]) => row.id };

describe('DataTable', () => {
  it('associates a caption and scoped headers with real table rows and cells', () => {
    render(<DataTable {...props} />);
    const table = screen.getByRole('table', { name: 'Cities' });
    expect(table.tagName).toBe('TABLE');
    const headers = within(table).getAllByRole('columnheader');
    expect(headers.map((h) => h.textContent)).toEqual(['City', 'Note']);
    for (const header of headers) expect(header).toHaveAttribute('scope', 'col');
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(within(table).getByRole('cell', { name: 'Cairo' }).tagName).toBe('TD');
  });

  it('keeps custom input state with its row when the rows reorder', () => {
    const { rerender } = render(<DataTable {...props} />);
    const input = screen.getByRole('textbox', { name: 'Note for Cairo' });
    fireEvent.change(input, { target: { value: 'Visit again' } });
    rerender(<DataTable {...props} rows={[...rows].reverse()} />);
    expect(screen.getByLabelText('Note for Cairo')).toBe(input);
    expect(input).toHaveValue('Visit again');
    expect(screen.getByLabelText('Note for Oslo')).toHaveValue('');
  });

  it('allows keyboard activation of custom actions', async () => {
    const open = vi.fn();
    const user = userEvent.setup();
    render(<DataTable {...props} columns={[{ id: 'open', header: 'Action', cell: (r) => <button onClick={() => open(r.id)}>Open {r.name}</button> }]} />);
    await user.tab();
    expect(screen.getByRole('region')).toHaveFocus();
    await user.tab();
    await user.keyboard('{Enter}');
    expect(open).toHaveBeenCalledWith('a');
  });

  it('shows loading, failure and a successful empty result distinctly', () => {
    const empty = { ...props, rows: [], emptyTitle: 'No cities found' };
    const { rerender } = render(<DataTable {...empty} isLoading />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading Cities');
    expect(screen.queryByText(empty.emptyTitle)).toBeNull();
    rerender(<DataTable {...empty} error={{ status: 503, body: { message: 'private detail' } }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong on our side.');
    expect(screen.queryByText('private detail')).toBeNull();
    expect(screen.queryByText(empty.emptyTitle)).toBeNull();
    rerender(<DataTable {...empty} />);
    expect(screen.getByRole('heading', { name: empty.emptyTitle })).toBeInTheDocument();
  });
});
