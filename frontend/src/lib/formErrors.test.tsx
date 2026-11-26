import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useForm } from 'react-hook-form';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { TextField } from '@/components/TextField';
import { ApiError } from './api';
import { applyApiErrors } from './formErrors';

const schema = z.object({ email: z.string().email('Enter a valid email address'), name: z.string().min(1, 'Name is required') });
type Values = z.infer<typeof schema>;

function Form({ submit }: { submit: (v: Values) => Promise<void> }) {
  const { register, handleSubmit, setError, formState } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: '', name: '' } });
  return (
    <form
      onSubmit={handleSubmit(async (v) => {
        try {
          await submit(v);
        } catch (error) {
          const rest = applyApiErrors(error, setError, ['email', 'name']);
          if (rest) setError('root', { message: rest });
        }
      })}
    >
      <TextField label="Email" error={formState.errors.email?.message} {...register('email')} />
      <TextField label="Name" error={formState.errors.name?.message} {...register('name')} />
      {formState.errors.root ? <p role="alert">{formState.errors.root.message}</p> : null}
      <button type="submit">Save</button>
    </form>
  );
}

describe('applyApiErrors', () => {
  it('shows a zod error before anything is sent', async () => {
    const submit = vi.fn();
    render(<Form submit={submit} />);
    await userEvent.type(screen.getByLabelText('Email'), 'nope');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
  });

  it('puts backend field errors next to the right inputs', async () => {
    const submit = vi.fn().mockRejectedValue(new ApiError(400, 'Validation failed', [{ field: 'email', message: 'email is already registered' }]));
    render(<Form submit={submit} />);
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.co');
    await userEvent.type(screen.getByLabelText('Name'), 'Ali');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('email is already registered')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
  });

  it('returns details for fields the form does not have, and plain errors', () => {
    const setError = vi.fn();
    const unknown = new ApiError(400, 'Validation failed', [
      { field: 'email', message: 'bad email' },
      { field: 'extra', message: 'extra is wrong' },
    ]);
    expect(applyApiErrors(unknown, setError, ['email'])).toBe('extra is wrong');
    expect(setError).toHaveBeenCalledWith('email', { type: 'server', message: 'bad email' });
    expect(applyApiErrors(new ApiError(409, 'Already booked'), setError, ['email'])).toBe('Already booked');
    expect(applyApiErrors(new Error('boom'), setError, [])).toBe('boom');
    expect(applyApiErrors('weird', setError, [])).toBe('Something went wrong. Please try again.');
    expect(applyApiErrors(new ApiError(400, 'x', [{ field: 'email', message: 'm' }]), setError, ['email'])).toBeNull();
  });

  it('matches nested field names', () => {
    const setError = vi.fn();
    applyApiErrors(new ApiError(400, 'x', [{ field: 'passengers.0.name', message: 'required' }]), setError, ['passengers']);
    expect(setError).toHaveBeenCalledWith('passengers.0.name', { type: 'server', message: 'required' });
  });
});
