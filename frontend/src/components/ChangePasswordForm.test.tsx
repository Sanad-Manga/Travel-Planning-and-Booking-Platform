import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '@/lib/api';
import { ChangePasswordForm } from './ChangePasswordForm';

vi.mock('@/lib/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/api')>()), api: vi.fn() }));

const replace = vi.fn();
const logout = vi.fn();
const resetSession = vi.fn();
const toastSuccess = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }));
vi.mock('./AuthProvider', () => ({ useAuth: () => ({ user: { id: 'u1' }, loading: false, logout, resetSession }) }));
vi.mock('./ToastProvider', () => ({ useToast: () => ({ success: toastSuccess, error: vi.fn() }) }));

const apiMock = vi.mocked(api);

beforeEach(() => {
  apiMock.mockReset();
  replace.mockReset();
  logout.mockReset();
  logout.mockResolvedValue(undefined);
  resetSession.mockReset();
  toastSuccess.mockReset();
});

async function fill(current = 'Temp0rary1', next = 'N3wPassw0rd', confirm = next) {
  const user = userEvent.setup();
  render(<ChangePasswordForm />);
  if (current) await user.type(screen.getByLabelText(/Current password/), current);
  if (next) await user.type(screen.getByLabelText(/^New password/), next);
  if (confirm) await user.type(screen.getByLabelText(/Confirm new password/), confirm);
  await user.click(screen.getByRole('button', { name: 'Change password' }));
  return user;
}

describe('ChangePasswordForm (ACC-11)', () => {
  it('has a heading and three labelled password fields', () => {
    render(<ChangePasswordForm />);
    expect(screen.getByRole('heading', { level: 1, name: 'Change password' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Current password/)).toHaveAttribute('autocomplete', 'current-password');
    expect(screen.getByLabelText(/^New password/)).toHaveAttribute('autocomplete', 'new-password');
    expect(screen.getByLabelText(/Confirm new password/)).toHaveAttribute('type', 'password');
  });

  it('asks for every field and sends nothing', async () => {
    await fill('', '', '');
    expect(screen.getByText('Enter your current password.')).toBeInTheDocument();
    expect(screen.getByText('Enter a new password.')).toBeInTheDocument();
    expect(apiMock).not.toHaveBeenCalled();
  });

  it.each([
    ['short1', 'Use at least 8 characters.'],
    ['onlyletters', 'Use at least one letter and one digit.'],
    ['12345678', 'Use at least one letter and one digit.'],
  ])('rejects the weak new password %s', async (weak, message) => {
    await fill('Temp0rary1', weak);
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('rejects a new password equal to the current one', async () => {
    await fill('Temp0rary1', 'Temp0rary1');
    expect(screen.getByText(/different from your current password/i)).toBeInTheDocument();
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('rejects a confirmation that does not match', async () => {
    await fill('Temp0rary1', 'N3wPassw0rd', 'N3wPassw0rX');
    expect(screen.getByText(/do not match/i)).toBeInTheDocument();
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('on success: PATCHes, ends the session, says so and goes to /login', async () => {
    apiMock.mockResolvedValue(undefined);
    await fill();
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
    expect(apiMock).toHaveBeenCalledWith('/auth/change-password', {
      method: 'PATCH',
      body: { currentPassword: 'Temp0rary1', newPassword: 'N3wPassw0rd' },
    });
    expect(logout).toHaveBeenCalledTimes(1);
    expect(toastSuccess).toHaveBeenCalledWith('Password changed, please log in again.');
  });

  it('still leaves the session locally if the logout call fails', async () => {
    apiMock.mockResolvedValue(undefined);
    logout.mockRejectedValue(new TypeError('offline'));
    await fill();
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
    expect(resetSession).toHaveBeenCalledTimes(1);
  });

  it('shows backend field errors under the right fields', async () => {
    apiMock.mockRejectedValue(
      new ApiError(400, 'Validation failed', [{ field: 'currentPassword', message: 'Current password is incorrect' }], null, {
        statusCode: 400,
        message: 'Validation failed',
        details: [{ field: 'currentPassword', message: 'Current password is incorrect' }],
      }),
    );
    await fill();
    expect(await screen.findByText('Current password is incorrect')).toBeInTheDocument();
    expect(screen.getByLabelText(/Current password/)).toHaveAttribute('aria-invalid', 'true');
    expect(replace).not.toHaveBeenCalled();
  });

  it('shows a network failure as an alert with Try again, and keeps what was typed', async () => {
    apiMock.mockRejectedValueOnce(new TypeError('offline'));
    const user = await fill();
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn.t reach the server/i);
    expect(screen.getByLabelText(/^New password/)).toHaveValue('N3wPassw0rd');
    apiMock.mockResolvedValueOnce(undefined);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
  });

  it('disables the button while the request runs', async () => {
    apiMock.mockReturnValue(new Promise(() => undefined));
    await fill();
    await waitFor(() => expect(screen.getByRole('button', { name: /changing password/i })).toBeDisabled());
  });
});
