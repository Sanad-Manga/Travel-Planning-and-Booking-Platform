import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Breadcrumbs } from './Breadcrumbs';

const items = [{ label: 'Home', href: '/' }, { label: 'Flights', href: '/flights' }, { label: 'Booking' }];

describe('Breadcrumbs (GEN-15)', () => {
  it('is a navigation landmark labelled Breadcrumb', () => {
    render(<Breadcrumbs items={items} />);
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument();
  });

  it('lists the trail in order', () => {
    render(<Breadcrumbs items={items} />);
    const list = within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByRole('list');
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Home', 'Flights', 'Booking']);
  });

  it('links the earlier items', () => {
    render(<Breadcrumbs items={items} />);
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Flights' })).toHaveAttribute('href', '/flights');
  });

  it('marks the last item as the current page and does not link it', () => {
    render(<Breadcrumbs items={items} />);
    const current = screen.getByText('Booking');
    expect(current).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('link', { name: 'Booking' })).toBeNull();
  });

  it('keeps the last item current even if it was given an href', () => {
    render(<Breadcrumbs items={[{ label: 'Home', href: '/' }, { label: 'Hotels', href: '/hotels' }]} />);
    expect(screen.getByText('Hotels')).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('link', { name: 'Hotels' })).toBeNull();
  });

  it('only the last item is current', () => {
    const { container } = render(<Breadcrumbs items={items} />);
    expect(container.querySelectorAll('[aria-current]')).toHaveLength(1);
  });
});
