import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Card } from './Card';

describe('Card', () => {
  it('renders the title as a heading and the content', () => {
    render(<Card title="Your trip">Paris</Card>);
    expect(screen.getByRole('heading', { level: 2, name: 'Your trip' })).toBeInTheDocument();
    expect(screen.getByText('Paris')).toBeInTheDocument();
  });

  it('uses the requested heading level', () => {
    render(<Card title="Hotel" headingLevel={3}>x</Card>);
    expect(screen.getByRole('heading', { level: 3 })).toBeInTheDocument();
  });
});
