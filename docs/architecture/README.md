# Architecture of the Travel Planning and Booking Platform

> Verified against `develop` commit `a8e3c80` on 2026-11-27.

The architecture is documented with the **C4 model**, levels 1 to 3 only (no code level), as Mermaid diagrams in Markdown. GitHub renders them in the browser, and they are reviewed in pull requests like code. A single-page themed viewer ([viewer.html](viewer.html)) shows all of them with a light/dark switch.

## One-minute reading guide

1. **What is this and who uses it?** Read [Level 1: System context](01-system-context.md) (one picture).
2. **What runs where?** Read [Level 2: Containers](02-containers.md): browser, Next.js on port 3000, NestJS on port 3001, MongoDB, uploads, Stripe, email. The table under it explains the cookie login, the `/api` and `/uploads` proxy and the generated types.
3. **How does the frontend work and talk to the backend?** Read [Level 3: Frontend components](03-frontend-components.md), section A (the layers) and then [Dynamic flows](05-dynamic-flows.md) a and b.
4. **What is inside the backend?** Read [Level 3: Backend components](04-backend-components.md).
5. **Is anything wrong?** Read [FINDINGS](FINDINGS.md). It lists what was inconsistent when the diagrams were checked against the code.

| File | Contents |
|---|---|
| [01-system-context.md](01-system-context.md) | Level 1: users, the platform, Stripe, email, exchange rates |
| [02-containers.md](02-containers.md) | Level 2: containers, protocols, key mechanisms |
| [03-frontend-components.md](03-frontend-components.md) | Level 3 frontend: layers, routes by role (built and planned), feature modules and owners |
| [04-backend-components.md](04-backend-components.md) | Level 3 backend: module dependencies, request pipeline, controllers, roles |
| [05-dynamic-flows.md](05-dynamic-flows.md) | Five interaction flows: login and refresh, paginated list, booking and payment, image upload, server fetch |
| [06-dev-environment.md](06-dev-environment.md) | Optional: ports, environment variables, CI |
| [FINDINGS.md](FINDINGS.md) | Problems found while tracing the code, with severity and suggested owner |
| [viewer.html](viewer.html) | All diagrams on one themed page (open the file in a browser; needs internet for the Mermaid library) |

## Legend

Boxes use the C4 notation (person, system, container, component) with muted colours. The same colours are used in every diagram.

| Look | Meaning |
|---|---|
| Sand box | **Person**: a kind of user |
| Dark teal box, white text | **Our system** (level 1 only) |
| Light teal box | **Container**: something that runs on its own (frontend, API) or a page area |
| Light grey box | **Component**: a module, class or shared piece inside a container |
| Amber cylinder | **Data store**: MongoDB, the upload folder, the Swagger snapshot |
| Dashed grey box | **External system** we do not own (Stripe, SMTP, FX API), or a **planned** item that is not built yet (it says "planned") |
| Solid arrow | A call or dependency, labelled with what and which protocol |
| Dotted arrow | An asynchronous or looser link (webhook, "reads data of", "registers with") |

Sequence diagrams (level "dynamic") number each step; `alt` blocks show the alternatives.

## Keeping it up to date

Diagrams that nobody updates become wrong. The rule:

> **Update the diagrams in the same pull request** if you change a container, a route, a role guard, a module dependency, a payment or login step, or you merge a planned screen.

Suggested line for the pull request template (not added automatically, because it changes the check everyone uses): `- [ ] Architecture diagrams updated if containers, routes or module dependencies changed (docs/architecture)`.

How to update:

1. Edit the Mermaid block in the right file. Which one: new route or screen: `03-frontend-components.md` (diagram B, and C for owners); new backend module or `imports`: `04-backend-components.md`; changed login, payment or upload steps: `05-dynamic-flows.md`; new env variable or service: `06-dev-environment.md`.
2. Re-stamp the line at the top of each file you touched: "Verified against `develop` commit `<sha>` on `<date>`" (`git rev-parse --short origin/develop`).
3. If you found something wrong rather than changed something, add it to `FINDINGS.md` instead of silently drawing around it.
4. Rebuild the viewer: `node docs/architecture/build-viewer.mjs` (no dependencies; it reads the Markdown files here and writes `viewer.html`). Commit both.
5. Check that the diagrams render: open the Markdown on GitHub (preview in the pull request) or open `viewer.html`.

Tips: keep each diagram to about 25 boxes (split rather than cram); quote labels that contain brackets or slashes (`["..."]`); use `<br/>` for line breaks; the classDef lines at the bottom of each diagram carry the colours.
