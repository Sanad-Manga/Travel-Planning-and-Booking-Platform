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
