import type { components, paths } from './schema';

/**
 * GEN-02: types for the backend API, generated from its Swagger document (`npm run gen:api`).
 * `schema.d.ts` is generated: never edit it by hand. Use these helpers instead of writing response
 * and request shapes yourself, so a backend change shows up as a TypeScript error here.
 */
export type { components, paths };

/** A named DTO from the Swagger document, e.g. `Schema<'CountryResponseDto'>`. */
export type Schema<Name extends keyof components['schemas']> = components['schemas'][Name];

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

type Operation<P extends keyof paths, M extends Method> = paths[P][M];

/** The query-string parameters of an endpoint, e.g. `QueryOf<'/api/airports'>`. */
export type QueryOf<P extends keyof paths, M extends Method = 'get'> =
  Operation<P, M> extends { parameters: { query?: infer Q } } ? NonNullable<Q> : never;

/** The JSON body an endpoint accepts, e.g. `BodyOf<'/api/auth/login', 'post'>`. */
export type BodyOf<P extends keyof paths, M extends Method> =
  Operation<P, M> extends { requestBody: { content: { 'application/json': infer B } } } ? B : never;

/** The JSON a successful (200 or 201) call returns, e.g. `ResponseOf<'/api/auth/me'>`. */
export type ResponseOf<P extends keyof paths, M extends Method = 'get'> = Operation<P, M> extends {
  responses: infer R;
}
  ? R extends { 200: { content: { 'application/json': infer T } } }
    ? T
    : R extends { 201: { content: { 'application/json': infer T } } }
      ? T
      : void
  : never;

/** The shared pagination envelope (contracts.md section 3): `{ items, page, limit, total, totalPages }`. */
export interface Page<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/** Build `?a=1&b=2` from an object, skipping undefined and empty values. */
export function withQuery(path: string, query?: object): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `${path}?${text}` : path;
}
