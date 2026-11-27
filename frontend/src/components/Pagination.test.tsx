import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Pagination } from './Pagination';

describe('Pagination', () => {
  it('uses server totals and only changes page when the parent updates it', async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    const props = { page: 1, totalPages: 3, total: 23, onPageChange };
    const { rerender } = render(<Pagination {...props} />);
    expect(screen.getByRole('navigation', { name: 'Pagination' })).toHaveTextContent('Page 1 of 3');
    expect(screen.getByText('Results 1–10 of 23')).toBeVisible();
    const prev = screen.getByRole('button', { name: 'Previous page' });
    const next = screen.getByRole('button', { name: 'Next page' });
    expect(prev).toBeDisabled();
    await user.click(prev);
    await user.click(next);
    expect(screen.getByText('Page 1 of 3')).toBeVisible();
    expect(onPageChange.mock.calls).toEqual([[2]]);

    rerender(<Pagination {...props} page={3} />);
    expect(screen.getByText('Results 21–23 of 23')).toBeVisible();
    expect(next).toBeDisabled();
    await user.click(next);
    await user.click(prev);
    expect(onPageChange.mock.calls).toEqual([[2], [2]]);
  });

  it.each([
    { total: 0, totalPages: 0, text: 'No results' },
    { total: 2, totalPages: 1, text: 'Results 1–2 of 2' },
  ])('prevents navigation with $total results', async ({ total, totalPages, text }) => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    render(<Pagination page={1} {...{ total, totalPages, onPageChange }} />);
    expect(screen.getByText(text)).toBeVisible();
    expect(screen.queryByText('Page 1 of 0')).toBeNull();
    for (const control of screen.getAllByRole('button')) {
      expect(control).toBeDisabled();
      await user.click(control);
    }
    expect(onPageChange).not.toHaveBeenCalled();
  });

  it('uses a supplied server limit and omits the range when total is unavailable', () => {
    const props = { page: 2, totalPages: 3, limit: 5, onPageChange: vi.fn() };
    const { rerender } = render(<Pagination {...props} total={13} />);
    expect(screen.getByText('Results 6–10 of 13')).toBeVisible();
    rerender(<Pagination {...props} />);
    expect(screen.getByText('Page 2 of 3')).toBeVisible();
    expect(screen.queryByText(/Results/)).toBeNull();
  });
});
