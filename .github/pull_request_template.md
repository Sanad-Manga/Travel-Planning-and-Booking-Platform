<!-- Title: include the requirement ID, e.g. "feat(flights): round-trip search (FLT-12)". -->

## Ticket

Jira: SCRUM-__ / Requirement ID: ____

## What changed and who it affects

<!-- Short bullets. Name any other owner whose module or schema you touched or who must react. -->

-

## Evidence

<!-- Swagger tests you ran: happy path, validation error, wrong role, other user's resource, concurrency case if relevant. -->

-

## Before opening this PR (every box must be ticked or the PR check fails)

- [ ] I walked through every item in the "Checklist" section of my Jira ticket and each one is true
- [ ] Every acceptance criterion in the ticket is implemented (nothing extra, nothing missing)
- [ ] Shared enums, error shape, pagination, money (`...Cents`), dates (UTC), guards and cross-module services are used as in `docs/contracts.md`
- [ ] Auth: correct guard/role on every endpoint, ownership checked in the service
- [ ] Validation covers DTO rules and business rules in the service
- [ ] Every body field is validated in the DTO, and a bad body returns a 400 with one `details` entry per field (`{ field, message }`), and Swagger shows that 400
- [ ] Concurrency-sensitive code is atomic (no read-then-write) and has a test
- [ ] I only changed my own module; anything else is flagged above
- [ ] Swagger is complete and lists are paginated
- [ ] Tests added/updated; build, lint and tests pass locally
- [ ] No `.env`, secrets, card data, `console.log` or dead code
- [ ] `AI_PROMPTS.txt` updated with every AI prompt that shaped this code
