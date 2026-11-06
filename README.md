# Travel Planning and Booking Platform

GIU Software Project I (Winter 2026). NestJS backend, Next.js frontend, MongoDB Atlas.

## Structure
- `backend/` NestJS API (Milestone 1)
- `frontend/` Next.js app (Milestone 2)
- `docs/contracts.md` shared team contract (read before coding)
- `docs/requirements`, `docs/api` requirements and API docs
- `AI_PROMPTS.txt` mandatory AI prompt log

## Workflow
Branch from `develop`: `feature/<REQ-ID>-short-name`. PR into `develop`, reviewed by the team lead.
`develop` merges into `main` at each milestone. Never commit `.env`.

## Setup (backend)
Requires Node 22 or newer.

1. Copy `.env.example` to `backend/.env` and fill in values (the `MONGODB_URI` connection string comes from the team lead).
2. Install exactly the locked dependency versions (do not use `npm install`, and do not add a package without telling the lead):
   ```bash
   cd backend
   npm ci
   ```
3. Run the API:
   ```bash
   npm run start:dev
   ```
   - API base: `http://localhost:3001/api`
   - Swagger UI: `http://localhost:3001/api/docs` (log in first so the auth cookie is set)

The app refuses to start if `MONGODB_URI` is missing or still the placeholder.

### Useful scripts (run inside `backend/`)
| Command | What it does |
|---|---|
| `npm run start:dev` | Run with auto-reload |
| `npm run build` | Compile to `dist/` |
| `npm run seed:admin` | Build, then explicitly provision the administrator ([setup](backend/src/admin/README.md)) |
| `npm test` | Unit tests |
| `npm run test:e2e` | End-to-end tests (global validation, error shape, `/api` prefix) |
| `npm run lint` | ESLint check only, fails on problems (no `console.log` allowed) |
| `npm run lint:fix` | ESLint with auto-fix, edits files |

### Backend layout
```
backend/src/
  main.ts, setup-app.ts   app bootstrap: /api prefix, validation, error filter, cookies, CORS, Swagger
  app.module.ts           config + MongoDB connection; feature modules are added here by their owners
  config/                 typed env access and startup validation
  common/                 shared code only: enums, constants, error filter, pagination, validation pipe
  <module>/               one folder per feature (auth, flights, hotels, ...) added by its owner
```
Import shared code from one place: `import { Role, PaginationDto, paginate } from '../common';`.
Changes to `common/` need the lead's approval (see `docs/contracts.md`).
