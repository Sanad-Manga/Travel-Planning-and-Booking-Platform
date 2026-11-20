import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Spinner } from './Spinner';

describe('Spinner (GEN-16)', () => {
  it('is a status with a default label', () => {
    render(<Spinner />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
  });

  it('keeps the label visually hidden', () => {
    render(<Spinner label="Searching flights" />);
    expect(screen.getByText('Searching flights')).toHaveClass('visually-hidden');
  });

  it('hides the drawn circle from assistive tech', () => {
    const { container } = render(<Spinner />);
    expect(container.querySelector('.spinner')).toHaveAttribute('aria-hidden', 'true');
  });

  it('supports a small size', () => {
    const { container } = render(<Spinner size="sm" />);
    expect(container.querySelector('.spinner')).toHaveClass('spinner-sm');
  });
});
