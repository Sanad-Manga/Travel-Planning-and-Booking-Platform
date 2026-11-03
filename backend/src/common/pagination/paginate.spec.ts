import { PaginationDto } from './pagination.dto';
import { paginate, toPaginated } from './paginate';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

/* eslint-disable @typescript-eslint/no-explicit-any */
function fakeModel(rows: unknown[], total: number) {
  const calls: Record<string, unknown> = {};
  const query: any = {
    sort: (v: unknown) => ((calls.sort = v), query),
    populate: (v: unknown) => ((calls.populate = v), query),
    skip: (v: number) => ((calls.skip = v), query),
    limit: (v: number) => ((calls.limit = v), query),
    lean: () => query,
    exec: async () => rows,
  };
  const model: any = {
    find: () => query,
    countDocuments: () => ({ exec: async () => total }),
  };
  return { model, calls };
}

describe('paginate', () => {
  it('returns the contract envelope and skips the right number of rows', async () => {
    const { model, calls } = fakeModel([{ a: 1 }, { a: 2 }], 25);
    const result = await paginate(model, {}, { page: 3, limit: 10 }, { sort: { createdAt: -1 } });
    expect(result).toEqual({ items: [{ a: 1 }, { a: 2 }], page: 3, limit: 10, total: 25, totalPages: 3 });
    expect(calls.skip).toBe(20);
    expect(calls.limit).toBe(10);
    expect(calls.sort).toEqual({ createdAt: -1 });
  });

  it('maps documents to response DTOs', async () => {
    const { model } = fakeModel([{ _id: 'x1', secret: 's' }], 1);
    const result = await paginate(model, {}, { page: 1, limit: 10 }, { map: (d) => ({ id: d._id }) });
    expect(result.items).toEqual([{ id: 'x1' }]);
  });

  it('reports zero pages for an empty result', () => {
    expect(toPaginated([], 0, 1, 10)).toEqual({ items: [], page: 1, limit: 10, total: 0, totalPages: 0 });
  });
});

describe('PaginationDto', () => {
  const run = (plain: object) => {
    const dto = plainToInstance(PaginationDto, plain);
    return validate(dto).then((errors) => ({ dto, errors }));
  };

  it('defaults to page 1, limit 10', async () => {
    const { dto, errors } = await run({});
    expect(errors).toHaveLength(0);
    expect([dto.page, dto.limit]).toEqual([1, 10]);
  });

  it('converts query strings to numbers', async () => {
    const { dto, errors } = await run({ page: '2', limit: '50' });
    expect(errors).toHaveLength(0);
    expect([dto.page, dto.limit]).toEqual([2, 50]);
  });

  it.each([{ limit: '51' }, { limit: '0' }, { page: '0' }, { page: 'abc' }])('rejects %p', async (q) => {
    const { errors } = await run(q);
    expect(errors.length).toBeGreaterThan(0);
  });
});
