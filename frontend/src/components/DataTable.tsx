import type { Key, ReactNode } from 'react';
import { toFriendlyError } from '@/lib/apiError';
import { Alert } from './Alert';
import { EmptyState } from './EmptyState';
import { Spinner } from './Spinner';

export interface TableColumn<T> {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
}

interface DataTableProps<T> {
  caption: string;
  columns: readonly TableColumn<T>[];
  rows: readonly T[];
  rowKey: (row: T) => Key;
  isLoading?: boolean;
  error?: unknown;
  emptyTitle?: string;
  /** Shows a "Try again" button on the error alert, e.g. `list.revalidate`. */
  onRetry?: () => void;
}

export function DataTable<T>({ caption, columns, rows, rowKey, isLoading, error, emptyTitle = 'No results', onRetry }: DataTableProps<T>) {
  if (error) {
    const { message, hint } = toFriendlyError(error);
    return <Alert variant="error" hint={hint} onRetry={onRetry}>{message}</Alert>;
  }
  if (isLoading) return <Spinner label={`Loading ${caption}`} />;
  if (!rows.length) return <EmptyState title={emptyTitle} />;

  return (
    <div className="table-scroll data-table-scroll" role="region" aria-label={`${caption} table area`} tabIndex={0}>
      <table className="data-table" role="table">
        <caption>{caption}</caption>
        <thead role="rowgroup">
          <tr role="row">
            {columns.map(({ id, header }) => <th key={id} scope="col" role="columnheader">{header}</th>)}
          </tr>
        </thead>
        <tbody role="rowgroup">
          {rows.map((row) => (
            <tr key={rowKey(row)} role="row">
              {columns.map(({ id, header, cell }) => (
                <td key={id} role="cell">
                  <span className="data-table-label" aria-hidden="true">{header}</span>
                  <div>{cell(row)}</div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
