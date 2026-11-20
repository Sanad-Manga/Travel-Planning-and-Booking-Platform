import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EmptyState } from './EmptyState';
import { emptyMessages } from './emptyMessages';

describe('EmptyState (GEN-04)', () => {
  it('says what is empty and what to do, as a polite status region', () => {
    render(<EmptyState title="No bookings yet" description="Search for a flight to make your first booking." icon="✈️" />);

    const region = screen.getByRole('status');
    expect(region).toHaveTextContent('No bookings yet');
    expect(screen.getByRole('heading', { level: 2, name: 'No bookings yet' })).toBeInTheDocument();
    expect(screen.getByText('Search for a flight to make your first booking.')).toBeInTheDocument();
    // The symbol is decoration only.
    expect(screen.getByText('✈️')).toHaveAttribute('aria-hidden', 'true');
  });

  it('works with only a title', () => {
    render(<EmptyState title="Nothing here" />);
    expect(screen.getByRole('heading', { name: 'Nothing here' })).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('can sit under a different heading level', () => {
    render(<EmptyState title="No comments yet" headingLevel={3} />);
    expect(screen.getByRole('heading', { level: 3, name: 'No comments yet' })).toBeInTheDocument();
  });

  it('offers a link when the action goes to a page', () => {
    render(<EmptyState title="No bookings yet" action={{ label: 'Search flights', href: '/flights' }} />);
    expect(screen.getByRole('link', { name: 'Search flights' })).toHaveAttribute('href', '/flights');
  });

  it('offers a button when the action does something on this page', async () => {
    const onClick = vi.fn();
    render(<EmptyState title="No comments yet" action={{ label: 'Write a comment', onClick }} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Write a comment' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('emptyMessages (GEN-04)', () => {
  it('gives every list a title that says what is empty and never ends in a stack trace or a bare "No data"', () => {
    for (const [key, message] of Object.entries(emptyMessages)) {
      expect(message.title.length, key).toBeGreaterThan(3);
      expect(message.title, key).not.toMatch(/no data|undefined|null|\[\]/i);
    }
  });

  it('renders a preset with its next step', () => {
    render(<EmptyState {...emptyMessages.flightBookings} />);
    expect(screen.getByRole('heading', { name: 'No flight bookings yet' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Search flights' })).toHaveAttribute('href', '/flights');
  });
});
