import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import BlogPage from './blog/page';
import FlightsPage from './flights/page';
import HotelsPage from './hotels/page';
import ItinerariesPage from './itineraries/page';
import LoginPage from './login/page';
import RegisterPage from './register/page';
import HomePage from './page';

const pages = [
  ['Flights', FlightsPage],
  ['Hotels', HotelsPage],
  ['Itineraries', ItinerariesPage],
  ['Blog', BlogPage],
  ['Login', LoginPage],
  ['Register', RegisterPage],
] as const;

describe('placeholder pages (GEN-14)', () => {
  it.each(pages)('%s has an h1 and says it is coming soon', (name, Page) => {
    render(<Page />);
    expect(screen.getByRole('heading', { level: 1, name })).toBeInTheDocument();
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
  });

  it('home page has an h1 and no nested main landmark', () => {
    render(<HomePage />);
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole('main')).toBeNull();
  });
});
