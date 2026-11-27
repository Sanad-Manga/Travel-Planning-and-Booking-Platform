# Architecture findings

> Verified against `develop` commit `a8e3c80` on 2026-11-27. Nothing here has been fixed: this is a report for the team and Ahmed to triage.

**Method.** The diagrams were drawn from the code (module `imports`, controllers and `@Roles`, `next.config.ts`, `src/lib`, `src/api`, `src/components`, `src/app`), then compared with the plan in `travel-m2-plan/` (`02-architecture.md`, `tickets.csv`) and `docs/contracts.md`. Where docs and code disagree, the code wins and the disagreement is listed here. The backend route list was extracted from the controller decorators and compared with `frontend/openapi/openapi.json` by script (144 routes in code, 141 in the snapshot).

**Severity** is a guess: **High** = a user-visible bug or a security or data risk; **Medium** = will cause rework or a wrong result if not handled; **Low** = tidy-up or documentation; **Info** = status, no action needed.

## Summary

| ID | Severity | What | Suggested owner |
|---|---|---|---|
| [F-01](#f-01) | Medium | Swagger snapshot and generated types are missing two merged endpoints | Walid and Ahmed (then Ziad for a guard) |
| [F-02](#f-02) | Medium | Backend routes without `@Roles` let admins and moderators use traveller features | Module owners, decision by Ahmed |
| [F-03](#f-03) | Medium | No error, not-found or loading screens in the app | Ziad |
| [F-04](#f-04) | Medium | Backend endpoint for changing a flight booking has no frontend ticket | Ahmed (planning), Abdulrahman H |
| [F-05](#f-05) | Medium | Frontend has two real screens; every feature module is still unbuilt | Ahmed (planning) |
| [F-06](#f-06) | Low | Plan document `02-architecture.md` no longer matches the code | Ahmed |
| [F-07](#f-07) | Low | `/itineraries` placeholder has no guard; `/account` is open to roles that cannot deactivate | Yassin, Ziad |
| [F-08](#f-08) | Low | Four upload endpoints, no shared wrapper for `ImageUploader` | Walid |
| [F-09](#f-09) | Low | Stripe.js packages are not installed yet | Gabarty |
| [F-10](#f-10) | Low | `access_token` cookie name is duplicated in the frontend | Ziad |
| [F-11](#f-11) | Low | Swagger title still says "Milestone 1" | Backend owner of `setup-app.ts` |
| [F-12](#f-12) | Low | Developer example pages are routable in production builds | Ahmed |
| [F-13](#f-13) | Low | CORS is enabled although the browser never calls the API cross-origin | Ahmed |
| [F-14](#f-14) | Info | Tickets M2-09 and M2-10 are done in the backend | Ahmed (tracker) |

Frontend calls with no backend route: **none** (see [checked and consistent](#checked-and-consistent)).

---

<a id="f-01"></a>
## F-01 (Medium) Swagger snapshot is stale

- **What:** `frontend/openapi/openapi.json` and the generated `frontend/src/api/schema.d.ts` do not contain `GET /api/admin/providers` (ACC-15, merged in #208) or `GET /api/flights/mine` (FLT-29, merged in #204). Both exist in the backend. Until the snapshot is regenerated, `ResponseOf<'/api/admin/providers'>` does not compile, so the Providers page (M2-23) and My flights (M2-85) cannot use typed calls. (`POST /api/payments/webhook` is also missing, on purpose: it is excluded from Swagger.)
- **Where:** `frontend/openapi/openapi.json`, `frontend/src/api/schema.d.ts`, `backend/src/admin/provider-list.controller.ts`, `backend/src/flights/my-flights.controller.ts`.
- **Why it keeps happening:** regeneration is manual (`npm run gen:api`), and a backend pull request does not touch the frontend files.
- **Suggested fix (not done):** regenerate and commit both files; then consider a CI step or checklist line "backend routes changed: regenerate the frontend API types".
- **Owner:** Walid and Ahmed for the immediate regeneration (they need the two endpoints); Ziad owns the generation convention.

<a id="f-02"></a>
## F-02 (Medium) Roles: routes with no `@Roles` are open to every logged-in role

- **What:** `RolesGuard` lets a route through when it has no `@Roles`. These controllers have none, so an ADMIN, AIRLINE_MODERATOR or HOTEL_MODERATOR passes the role check and gets 2xx: creating and editing itineraries (`itineraries`, `activities`, `budgets`, `transport-costs`), writing blog posts, comments and likes (`posts`, `comments`), `favourites`, `reports`, `notifications`. The frontend plan treats these as traveller screens (a moderator "sees a friendly this page is for travellers message"), and the hotel and flight booking routes are `@Roles(Role.USER)`, so the rules are not consistent across modules.
- **Where:** `backend/src/itineraries/*.controller.ts`, `backend/src/blog/blog.controller.ts`, `comments.controller.ts`, `comment-item.controller.ts`, `post-images.controller.ts`, `post-itinerary.controller.ts`, `backend/src/favourites/favourites.controller.ts`, `backend/src/reports/reports.controller.ts`. `docs/contracts.md` says ownership is checked in the service, which holds, but it does not say which roles may use these features.
- **Decision needed:** is it intended that moderators and admins can blog and plan itineraries? If travellers only, add `@Roles(Role.USER)` (and the matching `RequireRole` on the pages). If everyone may, the frontend guards for those pages must be `RequireAuth`, not `RequireRole USER`, and the plan text should say so. Reports and notifications are plausibly for everyone.
- **Owner:** the module owners (Yassin itineraries, Yusuf blog, Gabarty reports and favourites per the tickets); decision by Ahmed.

<a id="f-03"></a>
## F-03 (Medium) No error, not-found or loading screens

- **What:** there is no `error.tsx`, `not-found.tsx`, `loading.tsx` or `global-error.tsx` anywhere under `frontend/src/app`. `serverApi` throws `ApiError` for non-401 failures and its comment says "shown by the nearest error.tsx / error boundary", but none exists, so a failing server-rendered page shows Next's generic error page. The plan also lists friendly `ErrorPage` / `NotFound` helpers (ACC-11, rejected private access) and none exists.
- **Where:** `frontend/src/app/`, `frontend/src/lib/serverApi.ts`.
- **Owner:** Ziad (shell and foundations). Needed before the server-rendered pages (booking details, itinerary detail, role dashboards).

<a id="f-04"></a>
## F-04 (Medium) Backend feature without a frontend ticket

- **What:** `PATCH /api/flight-bookings/:id/change-flight` (FLT-27, equal-fare change, one-way only) is implemented and tested in the backend. No ticket in `tickets.csv` covers a screen for it (M2-34..38 cover the wizard, list, cancel, e-ticket and seat selection). Either it is intentionally out of Milestone 2 scope, or a ticket is missing.
- **Where:** `backend/src/flights/flight-bookings.controller.ts` (line of `change-flight`), `travel-m2-plan/tickets.csv`.
- **Owner:** Ahmed to decide scope; Abdulrahman H if it is added.

<a id="f-05"></a>
## F-05 (Medium) Frontend is foundations only

- **What (status, not a defect):** the built frontend is the shell, the theme, auth screens (`/login`, `/change-password`), the shared components and the typed API layer. Eleven routes are `ComingSoon` placeholders (`/register`, `/forgot-password`, `/flights`, `/hotels`, `/blog`, `/itineraries`, `/bookings`, `/account`, `/admin`, `/airline`, `/hotel`). There is no `src/features/` folder. The frontend currently calls only `/auth/me`, `/auth/login`, `/auth/logout`, `/auth/change-password` and the four reference lookups (`airports`, `countries`, `cities`, `currencies`). The rest of the 144 backend routes have no frontend caller yet.
- **Risk:** about 60 feature tickets (Sprints S1 and S2) all depend on the same foundations being merged; the diagrams mark every planned screen so progress can be read off them.
- **Owner:** Ahmed (planning and tracking). Update the [frontend diagram](03-frontend-components.md) when a feature merges.

<a id="f-06"></a>
## F-06 (Low) Plan document is out of date

Where `travel-m2-plan/02-architecture.md` and the code disagree (code wins):

| Plan says | Code has |
|---|---|
| "no role-based route guard yet" | `RequireRole`, `lib/roles.ts` exist (M2-02) |
| Generated types at `types/api.d.ts` | `src/api/schema.d.ts`, helpers in `src/api/types.ts` |
| `lib/server.ts` for public server fetch | only `lib/serverApi.ts` (forwarded cookies, 401 signal); public pages can reuse it, since it sends no cookie when none exists |
| Route groups `(auth)`, `(traveller)`, `(public)`, and `airline/layout.tsx` with `RequireRole` | flat folders; each page wraps itself in `RequireRole`; no layout files per area |
| Wrong-role visitor "is redirected to their own home" | `RequireRole` shows an error alert with a "Go to your home" link |
| `NotificationBell`, `ReportDialog`, `BookingStatusActions`, `formatDateRange`, `ErrorPage` as shared blocks | none exist yet (planned tickets M2-17, M2-54, others) |

- **Owner:** Ahmed. Low risk, but new people read that document first.

<a id="f-07"></a>
## F-07 (Low) Guards on placeholder pages

- `/itineraries` is a placeholder with no `RequireAuth` or `RequireRole`, but every `itineraries` API call needs a login. Fine while it is a placeholder; the real page (M2-61) must add a guard.
- `/account` uses `RequireAuth` (any role), but `DELETE /api/users/me` is `@Roles(Role.USER)`. When M2-15 adds "Deactivate my account", moderators and admins must not see a button that will answer 403.
- **Where:** `frontend/src/app/itineraries/page.tsx`, `frontend/src/app/account/page.tsx`, `backend/src/users/users.controller.ts`.
- **Owner:** Yassin (itineraries), Ziad (account).

<a id="f-08"></a>
## F-08 (Low) Uploads: four endpoints, no shared wrapper

- **What:** `ImageUploader` expects each screen to pass `upload()` and `remove()`. The backend has four upload endpoints, all with the multipart field named `image` (consistent): `posts/:id/images`, `hotels/:id/photos`, `airlines/:id/logo`, `activities/:id/images`. No endpoint function or hook wraps them, so four screens may write four versions of the same `FormData` call.
- **Where:** `frontend/src/components/ImageUploader.tsx`, `frontend/src/api/`.
- **Suggested fix (not done):** one `uploadImage(endpoint, file)` and `removeImage(endpoint)` pair beside `referenceData.ts`.
- **Owner:** Walid (uploader author).

<a id="f-09"></a>
## F-09 (Low) Stripe.js is not installed

- **What:** the plan (and `.env.example`) expects `@stripe/stripe-js` and `@stripe/react-stripe-js` for Stripe Elements; neither is in `frontend/package.json`. `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` is documented but unused. This is expected until M2-51, but it is the one frontend dependency the riskiest screen needs, and installing it needs network access and a lockfile update.
- **Where:** `frontend/package.json`, `frontend/.env.example`.
- **Owner:** Gabarty (M2-51).

<a id="f-10"></a>
## F-10 (Low) Cookie name duplicated

- **What:** `serverApi.ts` hard-codes `'access_token'`; the backend defines it once in `ACCESS_TOKEN_COOKIE` (`backend/src/common/constants.ts`). They match today. If the backend name ever changes, server-rendered private pages silently fall into the 401 fallback.
- **Where:** `frontend/src/lib/serverApi.ts`, `backend/src/common/constants.ts`.
- **Owner:** Ziad. A comment pointing at the backend constant is enough.

<a id="f-11"></a>
## F-11 (Low) Swagger text is out of date

- **What:** the Swagger description says "GIU Software Project I - Milestone 1 backend", while the API now covers the whole platform.
- **Where:** `backend/src/setup-app.ts` (`buildSwaggerDocument`).
- **Owner:** whoever owns `setup-app.ts`. Cosmetic, but the same document feeds the frontend types.

<a id="f-12"></a>
## F-12 (Low) Example pages ship in production builds

- **What:** `/examples/theme` and `/examples/server-fetch` are normal routes (marked `noindex`) and are served by `next start` as well as `next dev`. Harmless, but visitors can reach them, and `/examples/theme` renders all shared components.
- **Where:** `frontend/src/app/examples/`.
- **Decision needed:** keep them as living documentation, or hide them outside development (for the deployment ticket M2-102/103).
- **Owner:** Ahmed.

<a id="f-13"></a>
## F-13 (Low) CORS is enabled but not needed

- **What:** the API calls `enableCors({ origin: FRONTEND_URL, credentials: true })`. The browser only talks to port 3000 and Next.js proxies `/api/*`, and server components call the API server-to-server, so cross-origin requests never happen in the intended setup. It is harmless, but a wrong `FRONTEND_URL` would suggest a problem that does not exist, and it leaves a credentialed cross-origin door open for one origin.
- **Where:** `backend/src/setup-app.ts`.
- **Owner:** Ahmed (decide to keep for Swagger and tooling, or remove).

<a id="f-14"></a>
## F-14 (Info) Backend tickets already delivered

- M2-09 (providers list for admin) is `GET /api/admin/providers` (merged #208) and M2-10 (my airline's flights) is `GET /api/flights/mine` (merged #204). The frontend tickets that depend on them (M2-23, M2-85) are unblocked once F-01 is fixed.
- **Owner:** Ahmed (tracker).

---

## Checked and consistent

These were checked in the code and found fine; listed so nobody repeats the work.

- **Every frontend API call has a backend route:** `/auth/me`, `/auth/login`, `/auth/logout`, `/auth/change-password`, `/airports`, `/countries`, `/cities`, `/currencies`, and `/auth/refresh` (inside `api()`). All exist with the same methods.
- **Role names match:** `USER`, `ADMIN`, `AIRLINE_MODERATOR`, `HOTEL_MODERATOR` are identical in `frontend/src/lib/roles.ts` and `backend/src/common/enums`.
- **Frontend guards agree with the backend** where both exist: `/admin` is ADMIN (`admin/*` controllers are `@Roles(ADMIN)`), `/airline` is AIRLINE_MODERATOR, `/hotel` is HOTEL_MODERATOR, `/bookings` is USER (`flight-bookings` and `hotel-bookings` are USER).
- **Cookie and proxy mechanics:** `access_token` (path `/`, 15 min) and `refresh_token` (path `/api/auth`, 30 min sliding) are both httpOnly and `sameSite: lax`; the refresh path survives the Next.js rewrite because the proxied path stays `/api/auth/refresh`.
- **`/uploads` rewrite** exists in `next.config.ts` next to the `/api` rewrite (M2-08), matching the backend's static serving outside the global prefix.
- **Upload field name** is `image` on all four upload endpoints, and the limit (5 MB, JPG/PNG) is the same in `ImageUploader` and the backend.
- **Route order inside modules** does not shadow static routes: `flights/search` and `flights/mine` are registered before `flights/:id`, `hotels/search` before `hotels/:id`, `posts/mine` before `posts/:id`.
- **The payment confirmation rule** holds in code: only the signature-verified webhook (`payments.service.ts`, `onSucceeded`) confirms a booking, and it compares amount and currency first.
- **Test doubles stay out of production:** `FakeStripeGateway`, `FakeBookingProvider` and `FakeEmailSender` exist in `src`, but production modules bind `StripePaymentGateway` and `SmtpEmailSender` (the no-op sender is chosen only when `NODE_ENV=test`).
- **Cross-module imports** form no cycle: Payments never imports Flights or Hotels; they register in `BookingProviderRegistry`.
