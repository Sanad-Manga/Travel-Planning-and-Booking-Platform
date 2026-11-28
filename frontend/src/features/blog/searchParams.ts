/** Next.js `searchParams` value: one string, several, or absent. */
export type ParamValue = string | string[] | undefined;

/** The first value of a query parameter, trimmed; '' when absent. */
export function firstParam(value: ParamValue): string {
  const text = Array.isArray(value) ? value[0] : value;
  return (text ?? '').trim();
}

/** A page number from the URL: a whole number from 1 up, otherwise 1. */
export function pageParam(value: ParamValue): number {
  const page = Number(firstParam(value));
  return Number.isSafeInteger(page) && page >= 1 ? page : 1;
}
