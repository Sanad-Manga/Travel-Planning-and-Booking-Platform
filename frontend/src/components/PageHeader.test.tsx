import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PageHeader } from './PageHeader';

describe('PageHeader (GEN-15)', () => {
  it('renders one h1 with the title', () => {
    render(<PageHeader title="Flights" />);
    expect(screen.getAllByRole('heading')).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Flights' })).toBeInTheDocument();
  });

  it('shows the short description', () => {
    render(<PageHeader title="Flights" description="Find a flight and book it." />);
    expect(screen.getByText('Find a flight and book it.')).toBeInTheDocument();
  });

  it('shows the primary action slot', () => {
    render(<PageHeader title="Blog" action={<button type="button">Write a post</button>} />);
    expect(screen.getByRole('button', { name: 'Write a post' })).toBeInTheDocument();
  });

  it('renders neither description nor action when not given', () => {
    const { container } = render(<PageHeader title="Hotels" />);
    expect(container.querySelector('.page-header-description')).toBeNull();
    expect(container.querySelector('.page-header-action')).toBeNull();
  });
});
