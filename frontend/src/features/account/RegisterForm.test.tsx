import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RegisterForm } from './RegisterForm';

const fetchMock = vi.fn();
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

async function fill({ name = 'Ali Hassan', email = 'ali@example.com', password = 'Passw0rdOK', terms = true } = {}) {
  if (name) await userEvent.type(screen.getByLabelText(/Full name/), name);
  if (email) await userEvent.type(screen.getByLabelText(/Email/), email);
  if (password) await userEvent.type(screen.getByLabelText(/^Password/), password);
  if (terms) await userEvent.click(screen.getByRole('checkbox', { name: /terms/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
}

describe('RegisterForm (ACC-01)', () => {
  it('checks every field before sending: name, email, password rule and the terms box', async () => {
    render(<RegisterForm />);
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Enter your name.')).toBeInTheDocument();
    expect(screen.getByText('Enter your email address.')).toBeInTheDocument();
    expect(screen.getByText('Use at least 8 characters.')).toBeInTheDocument();
    expect(screen.getByText('You must accept the terms and the privacy policy.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a password without a digit or an invalid email is caught next to the field', async () => {
    render(<RegisterForm />);
    await fill({ email: 'not-an-email', password: 'onlyletters' });
    expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument();
    expect(screen.getByText('Use at least one letter and one digit.')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Password/)).toHaveAttribute('aria-invalid', 'true');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the form and then tells the person to verify their email', async () => {
    fetchMock.mockResolvedValue(json(201, { id: '1', name: 'Ali Hassan', email: 'ali@example.com', emailVerified: false }));
    render(<RegisterForm />);
    await fill();
    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument();
    expect(screen.getByText(/We sent a verification link to ali@example.com/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/auth/register');
    expect(JSON.parse(init.body)).toEqual({ name: 'Ali Hassan', email: 'ali@example.com', password: 'Passw0rdOK', acceptTerms: true });
  });

  it('a duplicate email gets a clear message on the email field', async () => {
    fetchMock.mockResolvedValue(
      json(409, { statusCode: 409, message: 'Email already registered', details: [{ field: 'email', message: 'email already exists' }] }),
    );
    render(<RegisterForm />);
    await fill();
    expect(await screen.findByText('This email is already registered. Log in or use another email.')).toBeInTheDocument();
    expect(screen.getByLabelText(/Email/)).toHaveAttribute('aria-invalid', 'true');
  });

  it('other backend field errors appear next to their field', async () => {
    fetchMock.mockResolvedValue(
      json(400, { statusCode: 400, message: 'Validation failed', details: [{ field: 'password', message: 'password is too long (maximum 72 bytes)' }] }),
    );
    render(<RegisterForm />);
    await fill();
    expect(await screen.findByText('password is too long (maximum 72 bytes)')).toBeInTheDocument();
  });

  it('a server or network failure shows an alert with Try again', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    render(<RegisterForm />);
    await fill();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    fetchMock.mockResolvedValueOnce(json(201, { id: '1', name: 'Ali Hassan', email: 'ali@example.com', emailVerified: false }));
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument();
  });
});
