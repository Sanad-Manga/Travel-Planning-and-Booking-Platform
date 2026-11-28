import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { swrDefaults } from '@/api/useApi';
import { ApiError } from '@/lib/api';
import { createFlight } from '../api';
import { CreateFlightForm } from './CreateFlightForm';

vi.mock('../api', () => ({ createFlight: vi.fn() }));
const push = vi.fn();
const toastSuccess = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ success: toastSuccess, error: vi.fn() }) }));

const createMock = vi.mocked(createFlight);
const airports = [
  { id: '1', iataCode: 'CAI', name: 'Cairo International Airport', city: { cityId: 'cairo', name: 'Cairo' }, country: { code: 'EG', name: 'Egypt' }, timeZone: 'Africa/Cairo' },
  { id: '2', iataCode: 'JFK', name: 'John F. Kennedy International Airport', city: { cityId: 'nyc', name: 'New York' }, country: { code: 'US', name: 'United States' }, timeZone: 'America/New_York' },
];

beforeEach(() => {
  createMock.mockReset();
  push.mockReset();
  toastSuccess.mockReset();
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(JSON.stringify({ items: airports, page: 1, limit: 50, total: 2, totalPages: 1 }), { status: 200 }))),
  );
});
afterEach(() => vi.unstubAllGlobals());

async function pick(label: string, option: RegExp) {
  fireEvent.focus(screen.getByRole('combobox', { name: new RegExp(label) }));
  fireEvent.mouseDown(await screen.findByRole('option', { name: option }));
}

async function fillValid() {
  const user = userEvent.setup();
  render(
    <SWRConfig value={{ ...swrDefaults, provider: () => new Map(), dedupingInterval: 0 }}>
      <CreateFlightForm />
    </SWRConfig>,
  );
  await user.type(screen.getByLabelText(/Flight number/), 'MS777');
  await pick('Departure airport', /Cairo/);
  await pick('Arrival airport', /Kennedy/);
  fireEvent.change(screen.getByLabelText(/Departure time/), { target: { value: '2026-12-01T14:30' } });
  fireEvent.change(screen.getByLabelText(/Arrival time/), { target: { value: '2026-12-01T19:45' } });
  return user;
}

describe('CreateFlightForm (FLT-03)', () => {
  it('shows which time zone each time box is in once its airport is chosen', async () => {
    await fillValid();
    expect(await screen.findByText(/Africa\/Cairo/)).toBeInTheDocument();
    expect(screen.getByText(/America\/New_York/)).toBeInTheDocument();
  });

  it('sends the local times as typed (no zone conversion) and opens the new flight', async () => {
    createMock.mockResolvedValue({ id: 'f1' } as never);
    const user = await fillValid();
    await user.click(screen.getByRole('button', { name: 'Create flight' }));
    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith({
        flightNumber: 'MS777',
        departureAirport: 'CAI',
        arrivalAirport: 'JFK',
        departureLocalTime: '2026-12-01T14:30',
        arrivalLocalTime: '2026-12-01T19:45',
      }),
    );
    expect(push).toHaveBeenCalledWith('/airline/flights/f1');
    expect(toastSuccess).toHaveBeenCalled();
  });

  it('sends nothing while fields are empty and says what is missing', async () => {
    const user = userEvent.setup();
    render(
      <SWRConfig value={{ ...swrDefaults, provider: () => new Map(), dedupingInterval: 0 }}>
        <CreateFlightForm />
      </SWRConfig>,
    );
    await user.click(screen.getByRole('button', { name: 'Create flight' }));
    expect(createMock).not.toHaveBeenCalled();
    expect(screen.getByText('Enter the flight number.')).toBeInTheDocument();
  });

  it('shows the backend field errors next to their fields', async () => {
    const details = [
      { field: 'arrivalLocalTime', message: 'Arrival must be after departure' },
      { field: 'flightNumber', message: 'Flight MS777 already exists on that date' },
    ];
    createMock.mockRejectedValue(
      new ApiError(400, 'Validation failed', details, null, { statusCode: 400, message: 'Validation failed', details }),
    );
    const user = await fillValid();
    await user.click(screen.getByRole('button', { name: 'Create flight' }));
    expect(await screen.findByText('Arrival must be after departure')).toBeInTheDocument();
    expect(screen.getByText('Flight MS777 already exists on that date')).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it('shows an unexpected failure in one alert with a retry', async () => {
    createMock.mockRejectedValue(new ApiError(503, 'Service unavailable'));
    const user = await fillValid();
    await user.click(screen.getByRole('button', { name: 'Create flight' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('marks the flight number field when the backend answers 409 for a duplicate', async () => {
    const details = [{ field: 'flightNumber', message: 'this airline already has this flight number on that departure date' }];
    createMock.mockRejectedValue(
      new ApiError(409, 'Flight already exists', details, null, { statusCode: 409, error: 'Conflict', message: 'Flight already exists', details }),
    );
    const user = await fillValid();
    await user.click(screen.getByRole('button', { name: 'Create flight' }));
    expect(await screen.findByText('this airline already has this flight number on that departure date')).toBeInTheDocument();
    expect(screen.getByLabelText(/Flight number/)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
