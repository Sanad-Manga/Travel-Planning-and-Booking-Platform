# Level 1: System context

> Verified against `develop` commit `a8e3c80` on 2026-11-27. Legend: [README](README.md#legend).

**Question this answers:** who uses the platform, and which outside systems does it depend on?

```mermaid
flowchart TB
  guest["<b>Guest</b><br/>Not logged in. Searches flights and hotels,<br/>reads the blog and public itineraries"]:::person
  user["<b>Traveller (USER)</b><br/>Books flights and hotels, plans itineraries,<br/>writes blog posts, reviews, favourites"]:::person
  air["<b>Airline moderator</b><br/>Runs one airline: flights, cabins,<br/>baggage and cancellation policies"]:::person
  hot["<b>Hotel moderator</b><br/>Runs one hotel: rooms, availability,<br/>reservations, review replies"]:::person
  adm["<b>Admin</b><br/>Accounts, moderators, providers,<br/>reports, audit log, analytics"]:::person

  sys["<b>Travel Planning and Booking Platform</b><br/>Web app and API for searching, planning<br/>and paying for trips"]:::system

  stripe["<b>Stripe</b><br/>Card payments and refunds<br/>(test mode in this project)"]:::external
  smtp["<b>SMTP server</b><br/>Verification, reset and booking emails.<br/>In development: an Ethereal test inbox"]:::external
  fx["<b>FXRatesAPI</b><br/>Daily exchange rates for<br/>currency display"]:::external

  guest -->|"browses (HTTPS)"| sys
  user -->|"uses (HTTPS)"| sys
  air -->|"manages (HTTPS)"| sys
  hot -->|"manages (HTTPS)"| sys
  adm -->|"administers (HTTPS)"| sys

  sys -->|"creates payments and refunds (REST)"| stripe
  stripe -.->|"webhook: payment result"| sys
  sys -->|"sends email (SMTP)"| smtp
  sys -->|"fetches latest rates (HTTPS)"| fx

  classDef person fill:#e7e3d9,stroke:#85807a,color:#22232a
  classDef system fill:#2d6370,stroke:#224f5a,color:#ffffff
  classDef external fill:#ece9e1,stroke:#85807a,stroke-dasharray:4 3,color:#5a5b63
```

## Reading notes

- **Five kinds of visitor.** The backend knows four roles (`USER`, `ADMIN`, `AIRLINE_MODERATOR`, `HOTEL_MODERATOR`, `backend/src/common/enums`). A guest is simply "no role": only routes marked `@Public()` answer.
- **Only the platform talks to Stripe with secrets.** The browser is meant to send card details to Stripe directly (Stripe.js), so card data never reaches our API. The checkout page that does this is planned (ticket M2-51), not built yet.
- **A booking is confirmed only by Stripe's webhook**, never by the browser telling us the payment worked. See [flow c](05-dynamic-flows.md#c-flight-booking-payment-and-confirmation).
- **Reference data** (airports, cities, countries, attractions) is loaded into MongoDB once by `npm run seed` from CSV files in `backend/data/`. It is not a live external system.
- **Currency:** prices and payments use one platform currency (`PLATFORM_CURRENCY`, default USD); FXRatesAPI rates are only for showing converted amounts.
