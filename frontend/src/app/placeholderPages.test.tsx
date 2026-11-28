import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import BlogPage from './blog/page';
import FlightsPage from './flights/page';
import HotelsPage from './hotels/page';
import ForgotPasswordPage from './forgot-password/page';
import HomePage from './page';

const pages = [
  ['Flights', FlightsPage],
  ['Hotels', HotelsPage],
  ['Blog', BlogPage],
  ['Forgot password', ForgotPasswordPage],
] as const;

describe('placeholder pages (GEN-14)', () => {
  it.each(pages)('%s has an h1 and says it is coming soon', (name, Page) => {
    render(<Page />);
    expect(screen.getByRole('heading', { level: 1, name })).toBeInTheDocument();
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
  });

  it.each(pages)('%s has breadcrumbs ending in the current page, and a description', (name, Page) => {
    render(<Page />);
    const trail = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(trail).toHaveTextContent(`Home${name}`);
    expect(screen.getByText(name, { selector: '[aria-current="page"]' })).toBeInTheDocument();
    expect(document.querySelector('.page-header-description')).toBeTruthy();
  });

  it('home page has an h1 and no nested main landmark', () => {
    render(<HomePage />);
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole('main')).toBeNull();
  });
});
