<!-- Frontend PRs: open with ?template=frontend.md. Title: include the requirement ID, e.g. "feat(flights): add create-flight form (FLT-03)". -->

## Ticket

Jira: SCRUM-__ / Requirement ID: ____

## What changed and who it affects

<!-- Short bullets. Say which screens changed and how to see them. -->

-

## How I checked it

<!-- Steps to try it in the browser against the real backend, plus what I saw. -->

-

## Before opening this PR (every box must be ticked or the PR check fails)

- [ ] Requirement ID in the title; one ticket, one branch from the latest `develop`
- [ ] Works against the real backend (not only mocks)
- [ ] Loading, error (with Retry) and empty states on every list and page
- [ ] Destructive actions go through the confirm dialog
- [ ] Backend field errors (`details: [{ field, message }]`) are shown on the matching field
- [ ] Usable at 375 px wide, no horizontal page scroll
- [ ] Money is integer cents shown with `formatMoney`; flight times use `formatInZone`
- [ ] Only files in my own `features/<module>/` and its route files changed; shared files are flagged above
- [ ] At least one test; `npm run lint`, `typecheck`, `test` and `build` pass locally
- [ ] No tokens in storage, no secrets, no `console.log` or dead code
- [ ] `AI_PROMPTS.txt` updated in the agreed format
