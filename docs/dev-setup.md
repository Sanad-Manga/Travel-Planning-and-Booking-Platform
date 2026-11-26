# Developer setup (backend + frontend)

Use this when you start work on a Milestone 2 ticket. The backend README has the full variable table; this is the short path.

## 1. Backend (`backend/`)

1. `cp .env.example .env` and fill `MONGODB_URI` (team Atlas string, your IP must be allowed) and two different `JWT_*` secrets.
2. For demos, add `AUTO_VERIFY_EMAIL=true` so new accounts can book without an inbox. **Dev/demo only, never in production.**
3. `npm install`, then once on an empty database: `npm run seed` (airports, cities, countries) and `npm run seed:admin` (needs `ADMIN_SEED_*` in `.env`).
4. `npm run start:dev` serves `http://localhost:3001/api` (Swagger at `/api/docs`).

## 2. Frontend (`frontend/`)

1. `cp .env.example .env.local`. `BACKEND_URL` defaults to `http://localhost:3001`.
2. `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` takes the **publishable** test key (`pk_test_...`). Never put a secret key (`sk_...`) in a `NEXT_PUBLIC_*` variable: the browser receives it.
3. `npm install`, then `npm run dev` on `http://localhost:3000`.
4. The browser only talks to port 3000. Next.js forwards `/api/*` and `/uploads/*` (images such as logos and photos) to the backend, so cookies stay same-origin.

## 3. Demo accounts

Create them once through the app or Swagger, in this order (details: README "Demo setup"):

| Who | How | Note |
|---|---|---|
| Admin | `npm run seed:admin` | credentials from `ADMIN_SEED_*` |
| Airline / hotel moderator | admin creates the provider, then `POST /api/admin/moderators` | temporary password; the first login forces a change |
| Traveller | register on `/register` | verified automatically when `AUTO_VERIFY_EMAIL=true`; otherwise open the link printed in the backend log (`Email preview (test inbox):`) |

## 4. Payments (Stripe test mode)

A booking becomes `CONFIRMED` only when Stripe calls the backend webhook. Keep this running during any payment demo:

```
stripe listen --forward-to localhost:3001/api/payments/webhook
```

Copy the printed `whsec_...` into `STRIPE_WEBHOOK_SECRET` in `backend/.env` and restart the API. Test card: `4242 4242 4242 4242`, any future date, any CVC. Complete the payment within the 10-minute hold.

## 5. Before you open a PR

Run in `frontend/`: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`. Open the PR with the frontend template: add `?template=frontend.md` to the new-PR URL. Every box must be ticked or the checklist check fails.
