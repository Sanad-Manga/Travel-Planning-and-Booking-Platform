import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TextField } from './TextField';

describe('TextField', () => {
  it('ties the label to the input', () => {
    render(<TextField label="Email" type="email" />);
    expect(screen.getByLabelText('Email')).toHaveAttribute('type', 'email');
  });

  it('marks a required field', () => {
    render(<TextField label="Name" required />);
    expect(screen.getByLabelText(/Name/)).toBeRequired();
  });

  it('announces the hint and the error with the input', () => {
    render(<TextField label="Password" hint="At least 8 characters" error="Password is too short" />);
    const input = screen.getByLabelText('Password');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('At least 8 characters Password is too short');
  });

  it('is not invalid without an error', () => {
    render(<TextField label="City" />);
    expect(screen.getByLabelText('City')).not.toHaveAttribute('aria-invalid');
  });
});
