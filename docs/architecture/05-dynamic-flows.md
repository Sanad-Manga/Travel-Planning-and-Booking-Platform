# Dynamic diagrams: how the parts interact

> Verified against `develop` commit `a8e3c80` on 2026-11-27. Legend: [README](README.md#legend).

These are C4 "dynamic" diagrams: numbered interactions between the containers and components of levels 2 and 3, for the five flows that explain most of the system. Steps marked **(planned)** describe a screen that is not built yet; the backend half of those flows is real.

1. [Login, cookies, silent refresh and redirect](#a-login-cookies-silent-refresh-and-redirect)
2. [A paginated list screen](#b-a-paginated-list-screen)
3. [Flight booking, payment and confirmation](#c-flight-booking-payment-and-confirmation)
4. [Image upload and display](#d-image-upload-and-display)
5. [Server component fetch with browser fallback on 401](#e-server-component-fetch-with-browser-fallback-on-401)

## a. Login, cookies, silent refresh and redirect

**Why it matters:** this is the one mechanism every private screen relies on. Tokens exist only in httpOnly cookies; the page knows who you are only through `GET /api/auth/me`.

```mermaid
%%{init: {"sequence": {"wrap": true, "width": 150, "messageMargin": 32}}}%%
sequenceDiagram
  autonumber
  actor U as Visitor
  participant AP as AuthProvider
  participant A as api()
  participant N as Next.js proxy
  participant B as NestJS API
  participant DB as MongoDB

  Note over AP,B: Page load: who am I?
  AP->>A: GET /auth/me (redirectOn401: false)
  A->>N: GET /api/auth/me (cookies)
  N->>B: forward
  B-->>A: 401 (no or expired access_token)
  A->>N: POST /api/auth/refresh (once, shared)
  N->>B: forward (refresh_token cookie, path /api/auth only)
  B->>DB: consume refresh token (single use), check account
  B-->>A: 401, cookies cleared
  A-->>AP: guest, user = null

  Note over U,B: Login
  U->>AP: submit email and password (LoginForm)
  AP->>A: POST /auth/login (retryOn401: false)
  A->>N: POST /api/auth/login
  N->>B: forward
  B->>DB: check password hash, lockout (5 tries, 15 min), status
  B-->>A: 200 user + Set-Cookie access_token (15 min), refresh_token (30 min sliding)
  A-->>AP: user (role, mustChangePassword)
  AP-->>U: redirect: temporary password to /change-password, else returnTo, else the role home

  Note over U,B: Later: access token expires mid-session
  U->>A: any api() call
  A->>N: request with expired access_token
  N->>B: forward
  B-->>A: 401
  A->>N: POST /api/auth/refresh (parallel failures share this one call)
  N->>B: forward
  B->>DB: rotate refresh token
  B-->>A: 200 + new cookies
  A->>N: retry the original request once
  N->>B: forward
  B-->>A: 200 data
  Note over A,U: If refresh fails: redirect to /login?returnTo=path (no loop on /login)
```

Role home after login: USER `/`, AIRLINE_MODERATOR `/airline`, HOTEL_MODERATOR `/hotel`, ADMIN `/admin` (`src/lib/roles.ts`).

## b. A paginated list screen

**Why it matters:** every list in the app (bookings, accounts, flights, reports) is meant to follow this exact path, so the same four states appear everywhere. Today only the example screen and the tests use it.

```mermaid
%%{init: {"sequence": {"wrap": true, "width": 150, "messageMargin": 32}}}%%
sequenceDiagram
  autonumber
  participant P as Page (guarded)
  participant H as usePaginated
  participant S as useApi / SWR cache
  participant A as api()
  participant N as Next.js proxy
  participant C as Controller
  participant V as Service + paginate()
  participant DB as MongoDB

  P->>H: usePaginated('/api/admin/accounts', { role: 'USER' })
  H->>S: key = path?filters&page=1&limit=10
  Note over P: isLoading: show Skeleton
  S->>A: fetcher(key)
  A->>N: GET with cookies
  N->>C: forward
  Note over C: JwtAuthGuard, RolesGuard, ValidationPipe on the query DTO
  C->>V: list(query)
  V->>DB: find(filter).sort().skip().limit() and countDocuments(filter)
  DB-->>V: rows, total
  V-->>C: { items, page, limit, total, totalPages }
  C-->>A: 200 JSON
  A-->>S: data cached under the key
  S-->>H: data
  H-->>P: items, page, setPage, error, isLoading

  alt error
    S-->>P: error (ApiError, 4xx not retried)
    Note over P: Alert with Retry button that calls revalidate()
  else no rows
    Note over P: EmptyState with a next step
  else rows
    Note over P: DataTable plus Pagination
  end

  P->>H: setPage(2)
  H->>S: key with page=2 (cached pages show instantly)
  Note over H: New filters reset to page 1. If the last page becomes empty after a delete, the hook steps back one page.
```

## c. Flight booking, payment and confirmation

**Why it matters:** the riskiest flow. Money is involved, and the booking must never be confirmed by anything except Stripe's signed webhook.

```mermaid
%%{init: {"sequence": {"wrap": true, "width": 150, "messageMargin": 32}}}%%
sequenceDiagram
  autonumber
  actor U as Traveller
  participant F as Frontend (planned screens)
  participant B as NestJS API
  participant DB as MongoDB
  participant S as Stripe

  U->>F: choose flight, passengers, baggage (wizard, planned M2-34)
  F->>B: POST /api/flight-bookings/hold
  B->>DB: hold seats, booking PENDING_PAYMENT, hold expires in HOLD_MINUTES (10)
  B-->>F: booking with holdExpiresAt
  F->>B: GET /api/bookings/FLIGHT/:id/policies
  B-->>F: cancellation tiers and baggage policy
  U->>F: ticks "I accept"
  F->>B: POST /api/bookings/FLIGHT/:id/accept-policies
  F->>B: POST /api/payments (bookingType, bookingId)
  B->>S: create PaymentIntent (amount from the booking, never from the client)
  S-->>B: intent id + clientSecret
  B->>DB: save Payment REQUIRES_PAYMENT
  B-->>F: clientSecret
  F->>S: confirm card with Stripe.js (card data goes only to Stripe) (planned M2-51)
  S-->>F: result shown as "Payment received, confirming..."

  Note over S,B: Asynchronous, signed by Stripe
  S->>B: POST /api/payments/webhook payment_intent.succeeded (raw body + stripe-signature)
  B->>B: verify signature, check amount and currency match the Payment
  B->>DB: BookingLifecycle.confirmPaid: one transaction, status CONFIRMED, booking reference FLT-..., seats booked
  B->>DB: Payment SUCCEEDED, in-app notification BOOKING_CONFIRMED

  loop about every 2 s, up to about 60 s (planned M2-52)
    F->>B: GET /api/flight-bookings/:id
    B-->>F: PENDING_PAYMENT until the webhook has run, then CONFIRMED
  end
  F-->>U: confirmation page, e-ticket (GET /api/flight-bookings/:id/e-ticket)

  Note over B,DB: Failure paths
  Note over B: payment_failed or canceled: Payment FAILED/CANCELLED, POST /api/payments/:id/retry allowed while the hold is alive
  Note over B: Hold passes without payment: the every-minute sweep (and any read) turns the booking EXPIRED and returns the seats
```

Hotel bookings follow the same payment path through `POST /api/hotel-bookings` and `bookings/HOTEL/...`; both register as providers in `BookingProviderRegistry`. For local demos the webhook only arrives if `stripe listen --forward-to localhost:3001/api/payments/webhook` is running ([dev-setup](../dev-setup.md)).

## d. Image upload and display

**Why it matters:** images are the one place the browser sends multipart data, and the returned URLs live outside `/api`.

```mermaid
%%{init: {"sequence": {"wrap": true, "width": 150, "messageMargin": 32}}}%%
sequenceDiagram
  autonumber
  actor U as User
  participant IU as ImageUploader
  participant Fn as upload() from the caller
  participant A as api()
  participant N as Next.js proxy
  participant B as Controller + UploadService
  participant DB as MongoDB
  participant FS as Upload store (disk)
  participant M as Visibility middleware

  U->>IU: choose a file
  Note over IU: checks JPG/PNG, 5 MB, max count before sending
  IU->>Fn: upload(file)
  Fn->>A: POST /posts/:id/images with FormData field "image"
  A->>N: multipart (no JSON content type)
  N->>B: forward
  Note over B: JwtAuthGuard, ownership check, FileInterceptor limit 5 MB
  B->>B: validate it is a real JPG or PNG
  B->>DB: UploadedFile record, state pending (unique slot per owner)
  B->>FS: write file
  B->>DB: state ready
  B-->>A: 201 { id, url: "/uploads/id.png" }
  A-->>IU: ImageReference, preview shown

  Note over U,FS: Display
  U->>N: browser requests GET /uploads/id.png (img tag)
  N->>M: rewrite /uploads/* to the backend (no /api prefix)
  M->>DB: who may see this file? draft-post images: owner only
  M->>FS: ServeStatic reads public/id.png
  FS-->>U: image bytes

  Note over IU,A: Remove: confirm dialog, then DELETE /posts/:id/images/:imageId, then the file is deleted too
```

The uploader itself never calls the API: each screen passes `upload()` and `remove()` that call the right endpoint (blog post images, hotel photos, airline logo, activity images). A wrapper for those endpoints does not exist yet; see [FINDINGS](FINDINGS.md).

## e. Server component fetch with browser fallback on 401

**Why it matters:** six private pages are planned to render on the server (booking details, itinerary detail, role dashboards). Refresh tokens rotate, and a server component cannot set cookies while rendering, so it must never refresh by itself.

```mermaid
%%{init: {"sequence": {"wrap": true, "width": 150, "messageMargin": 32}}}%%
sequenceDiagram
  autonumber
  actor U as Visitor
  participant NS as Next.js server (page.tsx)
  participant SA as serverApi()
  participant B as NestJS API
  participant CC as Client fallback component
  participant A as api() in the browser

  U->>NS: request a private page (cookies sent to port 3000)
  NS->>SA: serverApi('/api/auth/me')
  SA->>SA: read access_token with cookies(), the refresh token is never forwarded
  SA->>B: GET BACKEND_URL/api/auth/me (Cookie: access_token, no-store)
  alt 200
    B-->>SA: data
    SA-->>NS: { ok: true, data }
    NS-->>U: HTML already contains the data
  else 401 (guest or access token expired)
    B-->>SA: 401
    SA-->>NS: { ok: false, reason: 'unauthorized' }
    NS-->>U: HTML with the client fallback component
    U->>CC: hydrates in the browser
    CC->>A: useApi('/api/auth/me')
    A->>B: through the proxy, on 401 one refresh and one retry
    A-->>CC: data, or redirect to /login?returnTo=
  else other error
    B-->>SA: 4xx or 5xx
    SA-->>NS: throws ApiError, shown by the nearest error boundary
  end
```

The working example is `src/app/examples/server-fetch/`. Copy its shape for real pages.
