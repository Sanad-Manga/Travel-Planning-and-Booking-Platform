# Level 3: Frontend components

> Verified against `develop` commit `a8e3c80` on 2026-11-27. Legend: [README](README.md#legend).

**Question this answers:** what is inside the Next.js frontend, and how do its parts depend on each other?

The frontend today is a **solid foundation with almost no screens yet**: the shared building blocks, the typed API layer and the route guards exist and are tested; most pages are `ComingSoon` placeholders waiting for the feature tickets. Solid boxes below exist in the code; **dashed boxes are planned** (tickets in [section C](#c-feature-modules-and-owners)).

## A. Layers and dependencies

Read it top to bottom. Diagram A1 shows what wraps and protects a page; diagram A2 shows how any screen reaches the backend through one path that ends in `api()`.

### A1. Providers, guards and shared components

```mermaid
flowchart TB
  subgraph LAYOUT["app/layout.tsx wraps every page"]
    direction LR
    cp["ConfirmProvider<br/>useConfirm()"]:::component --> tp["ToastProvider<br/>useToast()"]:::component --> ap["AuthProvider<br/>useAuth(): user, login, logout"]:::component --> sp["SWRProvider<br/>app-wide SWR settings"]:::component --> shell["AppShell<br/>SkipLink, Header, main, Footer"]:::component
  end

  pages["<b>Pages</b> (src/app)<br/>thin screens: guard, hooks, components"]:::container

  subgraph GUARD["Route guards (convenience only, the backend enforces)"]
    direction LR
    rr["RequireRole(roles)<br/>wrong role: friendly message"]:::component
    ra["RequireAuth<br/>guest to /login?returnTo=<br/>forced password change"]:::component
    roles["lib/roles<br/>homePathFor, navLinksFor"]:::component
    rt["lib/returnTo, lib/pendingAction<br/>safe redirect back after login"]:::component
  end

  subgraph SHARED["Shared components (src/components)"]
    direction LR
    tbl["DataTable + Pagination<br/>cards on phones, onRetry,<br/>empty state"]:::component
    pick["ReferencePicker and<br/>Airport, City, Country,<br/>Currency pickers"]:::component
    img["ImageUploader<br/>JPG/PNG, 5 MB, count,<br/>upload and remove injected"]:::component
    form["TextField, FormActions,<br/>ConfirmDialog"]:::component
    ui["Alert, EmptyState, Skeleton, Spinner,<br/>Card, Steps, Breadcrumbs, PageHeader,<br/>StatusBadge, Countdown, TierEditor"]:::component
  end

  subgraph FMT["Formatting and errors (src/lib)"]
    direction LR
    fm["formatMoney (integer cents)<br/>formatInZone (airport time zone)"]:::component
    ae["toFriendlyError (apiError)<br/>applyApiErrors (formErrors)"]:::component
  end

  LAYOUT --> pages
  pages --> GUARD
  pages --> SHARED
  pages --> FMT
  rr --> ra
  rr --> roles
  ra --> rt
  ra -.->|"useAuth()"| ap

  classDef component fill:#f1efe8,stroke:#85807a,color:#22232a
  classDef container fill:#dde8e8,stroke:#2d6370,color:#22232a
```

### A2. The typed API layer: how a screen reaches the backend

```mermaid
flowchart TB
  subgraph UI["Who asks for data"]
    direction LR
    tbl["Screen with a list<br/>(DataTable + Pagination)"]:::component
    pick["Reference pickers"]:::component
    ap["AuthProvider<br/>/auth/me, login, logout"]:::component
    img["ImageUploader<br/>caller passes upload() and remove()"]:::component
    spage["Server component page"]:::component
  end

  up["usePaginated(endpoint, filters)<br/>page, limit=10, reset on filter change"]:::component
  rd["referenceData.ts<br/>endpoint functions, fetchAll"]:::component
  ua["useApi(key)<br/>SWR, the key is the API path"]:::component
  api["<b>api(path, options)</b><br/>fetch with cookies, one shared refresh on 401,<br/>ApiError with details[], FormData passthrough"]:::component
  sapi["serverApi(path)<br/>BACKEND_URL plus the access_token cookie"]:::component
  ty["types.ts and schema.d.ts<br/>ResponseOf, QueryOf, BodyOf, Schema"]:::component
  oas[("openapi/openapi.json<br/>Swagger snapshot")]:::store
  proxy["Next.js rewrites<br/>/api/* and /uploads/*"]:::container
  be["NestJS API :3001"]:::container

  tbl -.->|"fed by"| up
  pick --> rd
  up --> ua
  rd --> ua
  ua --> api
  ap --> api
  img -.-> api
  spage --> sapi
  api -->|"same-origin /api/*"| proxy
  proxy --> be
  sapi -->|"direct HTTP"| be
  oas -.->|"npm run gen:api"| ty
  ty -.->|"types only"| rd

  classDef component fill:#f1efe8,stroke:#85807a,color:#22232a
  classDef container fill:#dde8e8,stroke:#2d6370,color:#22232a
  classDef store fill:#f5ebd6,stroke:#8a5a12,color:#22232a
```

### What each part is for

| Part | Why it exists | File |
|---|---|---|
| `api()` | The only way the browser calls the backend. Cookies, one shared refresh on 401 (tokens rotate, so parallel failures must share one refresh), redirect to login, backend error shape `{ statusCode, message, details[] }` as `ApiError`. | `src/lib/api.ts` |
| `useApi` | SWR wrapper. The key is the API path, so every component sharing it shares the cache and `mutate(key)` refreshes all. 4xx answers are not retried. | `src/api/useApi.ts` |
| `usePaginated` | Standard list hook (`?page=&limit=10`), resets to page 1 on new filters, steps back if the last page empties. Returns `items`, `data`, `isLoading`, `error`, `revalidate`. | `src/api/usePaginated.ts` |
| `serverApi` | Server-component fetch with the visitor's `access_token` only; returns `{ ok: false, reason: 'unauthorized' }` on 401 so the page can fall back to a client component. | `src/lib/serverApi.ts` |
| `RequireAuth` / `RequireRole` | Hide a page from guests / the wrong role, and send people with a temporary password to `/change-password`. Nothing protected renders until the check passes. | `src/components/` |
| Types | Generated from the backend's Swagger snapshot, never hand-written. | `src/api/types.ts`, `schema.d.ts` |

### The standard recipe for a list screen

`Skeleton` while loading, then `Alert` with Retry on error, then `EmptyState` when empty, then content. `DataTable` has all four built in. See [flow b](05-dynamic-flows.md#b-a-paginated-list-screen).

## B. Routes by area (built and planned)

Route guards and what each page contains **today**. Solid = exists in `src/app`; dashed = planned in the route map of the frontend plan but no file yet.

```mermaid
flowchart LR
  subgraph PUB["Public (no guard)"]
    direction TB
    login["/login<br/>real LoginForm"]:::built
    reg["/register<br/>ComingSoon"]:::stub
    forgot["/forgot-password<br/>ComingSoon"]:::stub
    flights["/flights<br/>ComingSoon"]:::stub
    hotels["/hotels<br/>ComingSoon"]:::stub
    blog["/blog<br/>ComingSoon"]:::stub
    home["/<br/>home"]:::built
    pubplan["/flights/[id], /hotels/[id],<br/>/blog/[id], /authors/[id],<br/>/itineraries/public/..."]:::planned
  end

  subgraph ANY["RequireAuth (any role)"]
    direction TB
    acct["/account<br/>ComingSoon"]:::stub
    chg["/change-password<br/>real form, allowMustChange"]:::built
    notif["/notifications, /favourites"]:::planned
  end

  subgraph TRAV["RequireRole USER"]
    direction TB
    book["/bookings<br/>ComingSoon"]:::stub
    itin["/itineraries<br/>ComingSoon, NO guard yet"]:::stub
    travplan["/checkout/[type]/[id],<br/>/flights/[id]/book, /hotels/[id]/book,<br/>/bookings/flights/[id], /itineraries/[id],<br/>/blog/new, /blog/mine"]:::planned
  end

  subgraph AIR["RequireRole AIRLINE_MODERATOR"]
    direction TB
    airp["/airline<br/>ComingSoon"]:::stub
    airplan["/airline/profile, /flights,<br/>/flights/new, /flights/[id], /policies"]:::planned
  end

  subgraph HOT["RequireRole HOTEL_MODERATOR"]
    direction TB
    hotp["/hotel<br/>ComingSoon"]:::stub
    hotplan["/hotel/profile, /rooms, /status,<br/>/policies, /reservations, /reviews"]:::planned
  end

  subgraph ADM["RequireRole ADMIN"]
    direction TB
    admp["/admin<br/>ComingSoon"]:::stub
    admplan["/admin/accounts, /moderators/new,<br/>/providers, /bookings, /reports,<br/>/audit-logs, /analytics"]:::planned
  end

  subgraph EX["Examples (noindex, for developers)"]
    direction TB
    ex1["/examples/theme<br/>style guide, light and dark"]:::built
    ex2["/examples/server-fetch<br/>serverApi + client fallback"]:::built
  end

  classDef built fill:#dde8e8,stroke:#2d6370,color:#22232a
  classDef stub fill:#f1efe8,stroke:#85807a,color:#22232a
  classDef planned fill:#ffffff,stroke:#85807a,stroke-dasharray:4 3,color:#5a5b63
```

Legend for this diagram: teal = working screen, grey = placeholder (`ComingSoon`), dashed = planned.

**Role landing page after login:** USER to `/` (or `returnTo`), AIRLINE_MODERATOR to `/airline`, HOTEL_MODERATOR to `/hotel`, ADMIN to `/admin`, any user with a temporary password to `/change-password` (`src/lib/roles.ts`, `LoginForm.tsx`). The header shows role-specific links (`navLinksFor`); it links only to routes that exist today.

## C. Feature modules and owners

The plan puts each feature in `src/features/<module>/` (own `api.ts`, `hooks.ts`, `schemas.ts`, `components/`) with one owner, so pull requests rarely collide. **No `src/features/` folder exists yet**: every module below is planned. Owners and tickets come from `travel-m2-plan/tickets.csv`.

```mermaid
flowchart TB
  subgraph DONE["Foundations (built)"]
    direction LR
    f1["Typed API + hooks<br/>M2-01 Ziad"]:::built
    f2["RequireRole, role home<br/>M2-02 Ziad"]:::built
    f3["Pickers M2-03 Ziad<br/>DataTable, usePaginated M2-04 Walid<br/>ImageUploader M2-05 Walid"]:::built
    f4["formatMoney, formatInZone,<br/>StatusBadge, Countdown M2-06 Gabarty<br/>TierEditor M2-07 Gabarty"]:::built
    f5["serverApi M2-101 Ziad<br/>/uploads rewrite M2-08 Ahmed"]:::built
  end

  subgraph FEAT["Feature modules (planned, src/features/...)"]
    direction TB
    acc["account<br/>register, login, profile, verify, reset,<br/>notifications, favourites<br/>Ziad, Walid, Gabarty"]:::planned
    flt["flights<br/>search, details, booking wizard,<br/>my bookings, cancel, e-ticket, seats<br/>Abdu, Abdulrahman H"]:::planned
    htl["hotels<br/>search, details, rooms, booking,<br/>reservations, cancel, reviews<br/>Hessain, Yusuf"]:::planned
    chk["checkout<br/>policies, Stripe Elements,<br/>polling, refunds, reports<br/>Gabarty"]:::planned
    itn["itineraries<br/>editor, activities, public, clone,<br/>PDF, linked bookings, budget<br/>Yassin, Gabarty"]:::planned
    blg["blog<br/>list, post, likes, comments,<br/>editor, author page<br/>Yusuf, Yassin"]:::planned
    adm["admin<br/>accounts, moderators, providers,<br/>bookings, reports, audit, analytics<br/>Walid, Ziad"]:::planned
    arl["airline<br/>profile, flights, cabins,<br/>policies, passengers<br/>Ahmed, Abdulrahman H"]:::planned
    hmg["hotel-manager<br/>profile, photos, rooms,<br/>status, policies, reviews<br/>Hessain, Yusuf, Gabarty"]:::planned
  end

  DONE ==>|"used by every module"| FEAT

  %% invisible links lay the nine modules out as a 3 x 3 grid
  acc ~~~ flt ~~~ htl
  chk ~~~ itn ~~~ blg
  adm ~~~ arl ~~~ hmg
  acc ~~~ chk ~~~ adm
  flt ~~~ itn ~~~ arl
  htl ~~~ blg ~~~ hmg

  classDef built fill:#dde8e8,stroke:#2d6370,color:#22232a
  classDef planned fill:#ffffff,stroke:#85807a,stroke-dasharray:4 3,color:#22232a
```

Ticket ranges per module: account M2-11..19, admin M2-21..28, flights M2-31..38 and M2-85/86, hotels M2-41..49, checkout/shared M2-51..54, itineraries M2-55/56 and M2-61..68, blog M2-71..79, airline M2-81..84, hotel policies M2-87. Cross-cutting: walkthrough M2-91, SEO and accessibility pass M2-98, deployment M2-102..104.
