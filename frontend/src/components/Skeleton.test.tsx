import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Skeleton } from './Skeleton';

describe('Skeleton (GEN-16)', () => {
  it('is a single decorative block', () => {
    const { container } = render(<Skeleton />);
    const block = container.firstElementChild as HTMLElement;
    expect(block).toHaveClass('skeleton');
    expect(block).toHaveAttribute('aria-hidden', 'true');
  });

  it('takes a size', () => {
    const { container } = render(<Skeleton width="50%" height="3rem" />);
    expect(container.firstElementChild).toHaveStyle({ width: '50%', height: '3rem' });
  });

  it('renders several lines for a list or card, the last one shorter', () => {
    const { container } = render(<Skeleton lines={3} />);
    const lines = container.querySelectorAll('.skeleton');
    expect(lines).toHaveLength(3);
    expect(lines[2]).toHaveStyle({ width: '60%' });
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });
});
