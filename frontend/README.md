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

## Loading data on the server (GEN-17)

A server component (a `page.tsx` without `'use client'`) can load data before the HTML is sent with `serverApi<T>(path)` from `@/lib/serverApi`.

- It calls the backend directly (`BACKEND_URL`) and forwards only the user's `access_token` cookie, never the refresh token. Responses are never cached.
- It returns `{ ok: true, data }`, or `{ ok: false, reason: 'unauthorized' }` on a 401. Any other error is thrown as an `ApiError`.
- On `unauthorized`, render a client component that loads the same data with `useApi`. In the browser `api()` refreshes the session once and sends the user to login if that fails. A server component cannot refresh, because it cannot set the new cookies.
- Example: `src/app/examples/server-fetch/` (`/examples/server-fetch`, not indexed). It shows the signed-in user loaded on the server, with the browser fallback.

## Uploading images (GEN-08)

`ImageUploader` takes `images`, an `onChange` state updater, an async `upload(file)` that returns
`{ id, url }`, and an async `remove(image)`. It uses the app's `ConfirmProvider`. Pass a
`label` for the image group and set `disabled` while its parent is unavailable. Use a separate
component instance keyed by the entity ID when a view can switch between entities.

The default `maxImages` is 5. Set it to 1 for an airline logo. A selection is checked in full
before it uploads. Valid files are sent one at a time in selection order. If an upload fails,
previous successes stay in the list and the rest of the selection is skipped. Select the remaining
files again to retry. A failed deletion retains the preview, and its delete button can be used again.
Previews use the server's `/uploads/…` URL directly, so cookie-protected images go through the
same-origin rewrite. The server still validates the image content and enforces ownership and capacity.

```tsx
'use client';

import { useState } from 'react';
import type { ResponseOf } from '@/api/types';
import { ImageUploader, type ImageReference } from '@/components/ImageUploader';
import { api } from '@/lib/api';

function imageBody(file: File) {
  const body = new FormData();
  body.append('image', file);
  return body;
}

export function PostImages({ id, initialImages }: { id: string; initialImages: ImageReference[] }) {
  const [images, setImages] = useState(initialImages);
  const path = `/api/posts/${encodeURIComponent(id)}/images`;
  return (
    <ImageUploader label="Post images" images={images} onChange={setImages}
      upload={(file) => api<ResponseOf<'/api/posts/{id}/images', 'post'>>(path, {
        method: 'POST', body: imageBody(file),
      })}
      remove={(image) => api<void>(`${path}/${encodeURIComponent(image.id)}`, { method: 'DELETE' })}
    />
  );
}

export function AirlineLogo({ id, logoUrl }: { id: string; logoUrl?: string | null }) {
  const [images, setImages] = useState<ImageReference[]>(logoUrl ? [{ id, url: logoUrl }] : []);
  const path = `/api/airlines/${encodeURIComponent(id)}/logo`;
  return (
    <ImageUploader label="Airline logo" maxImages={1} images={images} onChange={setImages}
      upload={(file) => api<ResponseOf<'/api/airlines/{id}/logo', 'post'>>(path, {
        method: 'POST', body: imageBody(file),
      })}
      remove={() => api<void>(path, { method: 'DELETE' })}
    />
  );
}
```

All four POST routes take one file in the multipart field `image`. Pass `FormData` as the body
so the browser adds its boundary. Hotel photos use `/api/hotels/:id/photos` and return `{ id, url }`
like posts and logos. Activity uploads use `/api/activities/:id/images` and return the updated
`ActivityDto`. The activity service appends the new reference to its `images` array, so the upload
adapter can return the last entry. Post, hotel and activity deletes append the image ID to the
collection path. Airline logo deletion uses the same path as upload, so an existing `logoUrl` can
use the airline ID as its local preview key. Every successful deletion returns 204.
