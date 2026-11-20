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
