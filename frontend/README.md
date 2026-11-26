# Frontend (Milestone 2)

Next.js (App Router) + TypeScript. The backend lives in `../backend` (NestJS, port 3001 by default).

```
cd frontend
npm install
npm run dev        # http://localhost:3000
npm run lint
npm run typecheck
npm run build
```

- `/api/*` is proxied to the backend (`BACKEND_URL`, default `http://localhost:3001`), so the browser sees one origin and the httpOnly auth cookies work. See `.env.example`.
- All data comes from the backend as described in `../docs/contracts.md` (money is integer cents in `...Cents` fields, dates are UTC ISO strings, errors are `{ statusCode, error, message, details?, path, timestamp }`).
- Shared pieces live in `src/components`. One branch and one PR per ticket, as in the backend.

## Wording and flow guide

Short rules so every screen reads the same. GEN-15 gives the building blocks: `PageHeader`, `Breadcrumbs`, `FormActions` and `Steps`.

- **Buttons use verbs** that say what happens: "Search flights", "Book now", "Cancel booking", "Save changes". Not "Submit", "OK" or "Click here".
- **One primary action per page or form**, put first and styled `btn-primary`. Give it to `PageHeader` (`action`) or `FormActions`. The secondary action ("Cancel") stays visible next to it.
- **No jargon.** Write "booking" not "reservation record", "refund" not "reversal". Say what went wrong and what to do next (see `toFriendlyError`).
- **Every page has one h1** (from `PageHeader`), a one-line description, and breadcrumbs when it is below another page.
- **The main goals take at most 3 steps.** Searching and booking a flight or hotel, and sign-up, should each fit in three steps or fewer. Show progress with `Steps` ("Step 2 of 3").
- **Show that work is happening.** While a form submits, `FormActions` disables the primary button and shows a spinner; confirm the result with a toast or an inline `Alert`.

## Talking to the backend (GEN-02)

The API types are **generated from the backend's Swagger document**, so a backend change shows up as a TypeScript error instead of a runtime bug.

```
npm run gen:api        # backend running on :3001: reads http://localhost:3001/api/docs-json
npm run gen:api:file   # no backend: regenerates from the committed openapi/openapi.json
```

- `openapi/openapi.json` is the snapshot of the Swagger document the types were generated from. When the backend changes, run `gen:api` against it, then commit `openapi/openapi.json` and `src/api/schema.d.ts` together (save the document with `curl http://localhost:3001/api/docs-json -o openapi/openapi.json` first). Never edit `schema.d.ts` by hand.
- **Types:** import from `@/api/types`: `Schema<'CountryResponseDto'>`, `ResponseOf<'/api/auth/me'>`, `BodyOf<'/api/auth/login', 'post'>`, `QueryOf<'/api/airports'>`, `Page<T>`.
- **One file per backend module** in `src/api/` (see `referenceData.ts`), one function per endpoint, named like the action (`listAirports`, `getMe`, `createBooking`). Functions call `api()` from `@/lib/api` (cookies, one refresh on 401, `ApiError`), never `fetch`.
- **Reading data:** `useApi<T>(key)` from `@/api/useApi`. The key is the API path with its query (`airportsKey({ limit: 10 })`). Pass `null` to wait. Show `isLoading` with `Skeleton`, `error` with `toFriendlyError`, an empty list with `EmptyState`. 4xx answers are not retried.
- **Actions** (create, update, delete) run from event handlers, not in render. Destructive ones go through the confirm dialog, and success is shown with a toast.
- **Forms:** `react-hook-form` with a `zod` schema (`@hookform/resolvers/zod`) for checks before sending. On a failed submit call `applyApiErrors(error, setError, ['field', ...])` from `@/lib/formErrors` to put the backend's field errors next to the right inputs. It returns any message left over for an `Alert`.
- **Money is integer cents** (`...Cents`) and dates are UTC ISO strings. Format them at the edge of the UI only.
