import { FilterQuery, Model, PopulateOptions, ProjectionType, SortOrder } from 'mongoose';
import { DEFAULT_PAGE, DEFAULT_PAGE_SIZE } from '../constants';
import { PaginationDto } from './pagination.dto';

/** Shape of every list response (docs/contracts.md section 3). */
export interface PaginatedResponse<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface PaginateOptions<TDoc, TOut> {
  /**
   * REQUIRED. Turns each plain document into the response DTO (e.g. `_id` -> `id`, drop `__v` and secrets).
   * Responses must be DTOs, never raw documents, so there is no way to skip this.
   */
  map: (doc: any) => TOut; // eslint-disable-line @typescript-eslint/no-explicit-any
  /** Defaults to `{ _id: 1 }` so pages are stable. An explicit sort replaces it. */
  sort?: string | { [key: string]: SortOrder };
  projection?: ProjectionType<TDoc>;
  populate?: PopulateOptions | PopulateOptions[];
}

/** Used when the caller gives no sort, so the same row never shows up on two pages. */
const DEFAULT_SORT = { _id: 1 } as const;

/** Build the paginated envelope from rows you already have (e.g. an aggregation result). */
export function toPaginated<T>(items: T[], total: number, page: number, limit: number): PaginatedResponse<T> {
  return { items, page, limit, total, totalPages: total === 0 ? 0 : Math.ceil(total / limit) };
}

/** Run a filtered, sorted, paginated query on a Mongoose model and map every row to a response DTO. */
export async function paginate<TDoc, TOut>(
  model: Model<TDoc>,
  filter: FilterQuery<TDoc>,
  pagination: Pick<PaginationDto, 'page' | 'limit'>,
  options: PaginateOptions<TDoc, TOut>,
): Promise<PaginatedResponse<TOut>> {
  const page = pagination.page ?? DEFAULT_PAGE;
  const limit = pagination.limit ?? DEFAULT_PAGE_SIZE;

  let query = model.find(filter, options.projection).sort(options.sort ?? DEFAULT_SORT);
  if (options.populate) query = query.populate(options.populate);

  const [rows, total] = await Promise.all([
    query
      .skip((page - 1) * limit)
      .limit(limit)
      .lean()
      .exec(),
    model.countDocuments(filter).exec(),
  ]);

  return toPaginated(rows.map(options.map), total, page, limit);
}
