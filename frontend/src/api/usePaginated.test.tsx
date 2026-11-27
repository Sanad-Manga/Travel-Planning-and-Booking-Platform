import type { PropsWithChildren } from 'react';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataTable } from '@/components/DataTable';
import { Pagination } from '@/components/Pagination';
import { ApiError } from '@/lib/api';
import { swrDefaults } from './useApi';
import { usePaginated } from './usePaginated';

const fetchMock = vi.fn<(path: string) => Promise<Response>>();
const path = '/api/records';
let total: number;
function response(key: string, size = total) {
  const page = Number(new URL(key, 'http://localhost').searchParams.get('page'));
  const first = (page - 1) * 10;
  const items = Array.from({ length: Math.max(0, Math.min(10, size - first)) }, (_, i) => first + i + 1);
  return Response.json({ items, page, limit: 10, total: size, totalPages: Math.ceil(size / 10) });
}
function wrapper({ children }: PropsWithChildren) {
  return <SWRConfig value={{ ...swrDefaults, provider: () => new Map() }}>{children}</SWRConfig>;
}
type Input = { endpoint: string | null; filters?: Record<string, string | number | undefined> };
function mount(initialProps: Input = { endpoint: path }) {
  return renderHook(({ endpoint, filters }: Input) => usePaginated<number>(endpoint, filters), { initialProps, wrapper });
}
beforeEach(() => {
  total = 34;
  fetchMock.mockReset().mockImplementation(async (key) => response(key));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('usePaginated', () => {
  it('requests page one, exposes its envelope and keeps the complete server slice on page two', async () => {
    const { result } = mount();
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.data?.totalPages).toBe(4));
    expect(fetchMock.mock.calls[0][0]).toBe(path + '?page=1&limit=10');
    expect(result.current.data).toMatchObject({ page: 1, limit: 10, total: 34 });
    for (const invalid of [0, -1, 1.5, NaN, 5]) act(() => result.current.setPage(invalid));
    expect(result.current.page).toBe(1);
    act(() => result.current.setPage(2));
    expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(result.current.items).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]));
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([path + '?page=1&limit=10', path + '?page=2&limit=10']);
  });

  it('resets on a changed filter or endpoint, retaining the page for equivalent filters', async () => {
    const { result, rerender } = mount({ endpoint: path, filters: { status: 'A B', city: 4, page: 8, limit: 100 } });
    await waitFor(() => expect(result.current.data?.page).toBe(1));
    act(() => result.current.setPage(2));
    await waitFor(() => expect(result.current.data?.page).toBe(2));
    rerender({ endpoint: path, filters: { city: 4, status: 'A B', extra: undefined } });
    expect(result.current.page).toBe(2);
    rerender({ endpoint: path, filters: { city: 8 } });
    await waitFor(() => expect(result.current.data?.page).toBe(1));
    act(() => result.current.setPage(3));
    await waitFor(() => expect(result.current.data?.page).toBe(3));
    rerender({ endpoint: '/api/other', filters: { city: 8 } });
    await waitFor(() => expect(result.current.data?.page).toBe(1));
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      path + '?city=4&status=A+B&page=1&limit=10', path + '?city=4&status=A+B&page=2&limit=10',
      path + '?city=8&page=1&limit=10', path + '?city=8&page=3&limit=10', '/api/other?city=8&page=1&limit=10',
    ]);
  });

  it('pauses on a null key, resumes and distinguishes a server error from empty data', async () => {
    const { result, rerender } = mount({ endpoint: null });
    act(() => result.current.setPage(2));
    expect(result.current.isLoading).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(Response.json({ message: 'Forbidden' }, { status: 403 }));
    rerender({ endpoint: path });
    await waitFor(() => expect(result.current.error).toBeInstanceOf(ApiError));
    expect(result.current.error?.statusCode).toBe(403);
    expect(result.current.data).toBeUndefined();
    rerender({ endpoint: null });
    expect(result.current.error).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('ignores a late response after selecting a different query', async () => {
    let finish!: (value: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const { result, rerender } = mount();
    rerender({ endpoint: '/api/current' });
    await waitFor(() => expect(result.current.data?.total).toBe(34));
    await act(async () => finish(response(path + '?page=1', 0)));
    expect(result.current.data?.total).toBe(34);
    expect(result.current.items).toHaveLength(10);
  });

  it.each([{ size: 25, last: 3 }, { size: 0, last: 1 }])('recovers an out-of-range page after revalidation leaves $size rows', async ({ size, last }) => {
    const { result } = mount();
    await waitFor(() => expect(result.current.data?.page).toBe(1));
    act(() => result.current.setPage(4));
    await waitFor(() => expect(result.current.items).toEqual([31, 32, 33, 34]));
    total = size;
    await act(async () => { await result.current.revalidate(); });
    await waitFor(() => expect(result.current.data).toMatchObject({ page: last, total: size }));
    expect(result.current.page).toBe(last);
    expect(result.current.items).toEqual(size ? [21, 22, 23, 24, 25] : []);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});

it('connects the table and controls to server pages and refreshes the visible results', async () => {
  function List() {
    const list = usePaginated<number>(path);
    return <>
      <DataTable caption="Records" columns={[{ id: 'number', header: 'Number', cell: (n) => n }]}
        rowKey={(n) => n} rows={list.items} isLoading={list.isLoading} error={list.error} />
      {list.data && <Pagination {...list.data} onPageChange={list.setPage} />}
      <button onClick={() => void list.revalidate()}>Refresh records</button>
    </>;
  }
  total = 11;
  const user = userEvent.setup();
  render(<List />, { wrapper });
  expect(await screen.findByRole('cell', { name: '10' })).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Next page' }));
  expect(await screen.findByRole('cell', { name: '11' })).toBeVisible();
  expect(screen.queryByRole('cell', { name: '10' })).toBeNull();
  expect(screen.getByText('Results 11–11 of 11')).toBeVisible();
  total = 12;
  await user.click(screen.getByRole('button', { name: 'Refresh records' }));
  expect(await screen.findByRole('cell', { name: '12' })).toBeVisible();
  expect(screen.getByText('Page 2 of 2')).toBeVisible();
});
