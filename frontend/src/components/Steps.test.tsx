import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Steps } from './Steps';

const labels = ['Choose flight', 'Passenger details', 'Pay'];

describe('Steps (GEN-15)', () => {
  it('is an ordered list labelled Progress with one item per step', () => {
    render(<Steps steps={labels} current={2} />);
    const list = screen.getByRole('list', { name: 'Progress' });
    expect(list.tagName).toBe('OL');
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('marks only the current step with aria-current="step"', () => {
    const { container } = render(<Steps steps={labels} current={2} />);
    const current = container.querySelectorAll('[aria-current="step"]');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent('Passenger details');
  });

  it('says where you are in words, for everyone', () => {
    render(<Steps steps={labels} current={2} />);
    expect(screen.getByText('Step 2 of 3')).toBeInTheDocument();
  });

  it('tells screen readers which steps are done and which are still to come', () => {
    render(<Steps steps={labels} current={2} />);
    const [first, , third] = screen.getAllByRole('listitem');
    expect(first).toHaveTextContent('Choose flight (completed)');
    expect(third).toHaveTextContent('Pay (not started)');
  });

  it('styles completed, current and upcoming steps differently', () => {
    render(<Steps steps={labels} current={2} />);
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveClass('step-done');
    expect(items[1]).toHaveClass('step-current');
    expect(items[2]).toHaveClass('step-todo');
  });

  it('numbers the steps', () => {
    render(<Steps steps={labels} current={1} />);
    expect(screen.getAllByRole('listitem')[2]).toHaveTextContent('3');
  });

  it('clamps an out-of-range current step', () => {
    const { container } = render(<Steps steps={labels} current={9} />);
    expect(container.querySelector('[aria-current="step"]')).toHaveTextContent('Pay');
    expect(screen.getByText('Step 3 of 3')).toBeInTheDocument();
  });
});
