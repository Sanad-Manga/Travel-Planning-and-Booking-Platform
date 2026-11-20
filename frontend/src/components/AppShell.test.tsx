import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AppShell } from './AppShell';
import { Footer } from './Footer';

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));

describe('AppShell / Footer (GEN-14)', () => {
  it('has banner, main and contentinfo landmarks', () => {
    render(
      <AppShell>
        <h1>Hello</h1>
      </AppShell>,
    );
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('main')).toContainElement(screen.getByRole('heading', { name: 'Hello' }));
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
  });

  it('makes main a programmatic focus target for the skip link', () => {
    render(<AppShell>x</AppShell>);
    const main = screen.getByRole('main');
    expect(main).toHaveAttribute('id', 'main-content');
    expect(main).toHaveAttribute('tabindex', '-1');
  });

  it('puts the skip link before everything else', () => {
    render(<AppShell>x</AppShell>);
    const first = screen.getAllByRole('link')[0];
    expect(first).toHaveTextContent('Skip to main content');
  });

  it('footer has the site name and the current year', () => {
    render(<Footer />);
    expect(screen.getByRole('contentinfo')).toHaveTextContent(String(new Date().getFullYear()));
  });
});
