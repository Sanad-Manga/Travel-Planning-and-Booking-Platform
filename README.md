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

Keep `develop` green:
- `npm ci` in `backend/` also turns on a `pre-push` hook (`.githooks/pre-push`): before every `git push` the backend must build and lint (about a minute). Skip once with `git push --no-verify`.
- Always run `npm run build` after resolving merge conflicts, and never resolve conflicts in the GitHub web editor: it skips every local check (this is how `develop` broke after #53/#54).
- After another PR merges, use "Update branch" (or `git merge origin/develop`) on yours and wait for CI again before merging.
- CI also runs on every push to `develop`: a red run there means the last merge broke it, tell the lead at once.

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

### Environment variables (`backend/.env`, see `.env.example`)
| Variable | Needed for |
|---|---|
| `MONGODB_URI` | **Required.** The team MongoDB Atlas connection string; the API will not start without it. Atlas must allow your IP address (Network Access) |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | **Required.** Two different long random strings; the API refuses to start if they are missing, equal or weak |
| `PORT`, `FRONTEND_URL`, `COOKIE_SECURE=false` | Defaults for local development (`3001`, `http://localhost:3000`) |
| `ADMIN_SEED_EMAIL`, `ADMIN_SEED_PASSWORD`, `ADMIN_SEED_NAME` | Only for `npm run seed:admin` |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Only for the payment demo below (Stripe test mode) |
| `FX_API_KEY`, `PLATFORM_CURRENCY` | Currency conversion for itineraries (a free FXRatesAPI key is enough) |
| `HOLD_MINUTES` | How long a booking hold lasts (default 10) |
| `AUTO_VERIFY_EMAIL` | Optional, **dev/demo only**, default off. Only the exact value `true` makes new accounts start with a verified email (no verification email is sent), so demo users can book without an inbox. A warning is logged at startup when on. Never use in production |
| `SMTP_*` | Optional. Without them a throwaway test inbox is used and each email's preview link is printed in the backend log |


### Useful scripts (run inside `backend/`)
| Command | What it does |
|---|---|
| `npm run start:dev` | Run with auto-reload |
| `npm run build` | Compile to `dist/` |
| `npm run seed` | Build, then load the reference data (countries, cities, airports, attractions) from `backend/data/*.csv`. Safe to run before anything else; the app does not seed on start-up |
| `npm run seed:admin` | Build, then explicitly provision the administrator ([setup](backend/src/admin/README.md)) |
| `npm test` | Unit tests |
| `npm run test:e2e` | End-to-end tests (global validation, error shape, `/api` prefix) |
| `npm run lint` | ESLint check only, fails on problems (no `console.log` allowed) |
| `npm run lint:fix` | ESLint with auto-fix, edits files |

## Demo setup (Swagger walk-through)

Do these once, in this order, on an empty database:

1. `npm run seed` (reference data) and then `npm run seed:admin` (administrator, needs `ADMIN_SEED_*` in `backend/.env`). Without `npm run seed` there are no airports or cities, so creating flights and hotels fails validation.
2. Log in as the admin in Swagger (`POST /api/auth/login`), create an airline and a hotel, then create their moderators with `POST /api/admin/moderators`.
3. Each moderator logs in and changes the temporary password (`PATCH /api/auth/change-password`).
4. The airline moderator creates a flight and its cabins; the hotel moderator creates a room and its availability.
5. A traveler registers (`POST /api/auth/register`) and verifies the email before booking (ACC-02). In development the verification link is printed in the backend log on a line starting `Email preview (test inbox):`; open it, or call `GET /api/auth/verify-email` with its token.
6. Swagger sessions: the access cookie lasts 15 minutes and the session ends after 30 minutes without requests. Call `POST /api/auth/refresh` to renew it, or log in again.

### Demo a payment (confirm a booking)

A booking becomes `CONFIRMED` only when Stripe tells the API the payment succeeded. The webhook route (`POST /api/payments/webhook`) is hidden from Swagger on purpose: Stripe calls it, signed. To get a booking confirmed locally you need the [Stripe CLI](https://docs.stripe.com/stripe-cli) and test-mode keys:

1. Put your test secret key in `STRIPE_SECRET_KEY` and start the API (`npm run start:dev`).
2. In a second terminal run `stripe listen --forward-to localhost:3001/api/payments/webhook`. It prints a signing secret (`whsec_...`). Put it in `STRIPE_WEBHOOK_SECRET` in `backend/.env` and restart the API.
3. As the traveler, hold a booking (`POST /api/flight-bookings/hold` or `POST /api/hotel-bookings`), then `POST /api/bookings/{type}/{id}/accept-policies`.
4. `POST /api/payments` with `{ "bookingType": "FLIGHT", "bookingId": "<id>" }`. The response contains the PaymentIntent id (`pi_...`).
5. `stripe payment_intents confirm pi_... --payment-method pm_card_visa`. The CLI forwards `payment_intent.succeeded` to the webhook.
6. `GET /api/flight-bookings/{id}` (or `/api/hotel-bookings/{id}`) now shows `CONFIRMED`, with the e-ticket, cancel/refund and notifications available.

Do this within the 10-minute hold (`HOLD_MINUTES`). A paid intent that Stripe confirms after the hold has expired is refunded automatically.

Reviews (HTL-23) need a stay whose check-out has passed and that the nightly sweep has completed, so they cannot be created from a booking made during the demo. Use data prepared in advance for that part.

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
