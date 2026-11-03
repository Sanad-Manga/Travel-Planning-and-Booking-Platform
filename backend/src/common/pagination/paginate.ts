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
  sort?: string | { [key: string]: SortOrder };
  projection?: ProjectionType<TDoc>;
  populate?: PopulateOptions | PopulateOptions[];
  /**
   * Turn each plain document into the response DTO (e.g. `_id` -> `id`, drop secrets).
   * Responses must be DTOs, never raw documents.
   */
  map?: (doc: any) => TOut; // eslint-disable-line @typescript-eslint/no-explicit-any
}

/** Build the paginated envelope from rows you already have (e.g. an aggregation result). */
export function toPaginated<T>(items: T[], total: number, page: number, limit: number): PaginatedResponse<T> {
  return { items, page, limit, total, totalPages: total === 0 ? 0 : Math.ceil(total / limit) };
}

/** Run a filtered, sorted, paginated query on a Mongoose model. */
export async function paginate<TDoc, TOut = TDoc>(
  model: Model<TDoc>,
  filter: FilterQuery<TDoc>,
  pagination: Pick<PaginationDto, 'page' | 'limit'>,
  options: PaginateOptions<TDoc, TOut> = {},
): Promise<PaginatedResponse<TOut>> {
  const page = pagination.page ?? DEFAULT_PAGE;
  const limit = pagination.limit ?? DEFAULT_PAGE_SIZE;

  let query = model.find(filter, options.projection);
  if (options.sort) query = query.sort(options.sort);
  if (options.populate) query = query.populate(options.populate);

  const [rows, total] = await Promise.all([
    query
      .skip((page - 1) * limit)
      .limit(limit)
      .lean()
      .exec(),
    model.countDocuments(filter).exec(),
  ]);

  const items = (options.map ? rows.map(options.map) : rows) as TOut[];
  return toPaginated(items, total, page, limit);
}
