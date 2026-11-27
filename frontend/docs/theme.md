# Theme guide

The look of the app (called "Harbor x Linen" with a teal accent) lives in **one place**: the token blocks at the top of
[`src/app/globals.css`](../src/app/globals.css). Components only read those tokens, so a change there reaches every screen.

See it live at **/examples/theme** (every component and state, light and dark side by side).

## Change the look in one place

| I want to change | Edit in `globals.css` |
|---|---|
| The accent colour (buttons, links, focus, selected) | `--primary`, `--primary-hover`, `--primary-soft`, `--primary-text`, `--focus-color`, `--on-primary` |
| The page and card colours | `--background`, `--surface`, `--surface-2`, `--border`, `--border-strong` |
| Text colours | `--foreground`, `--muted` |
| Success, warning and error colours | `--success*`, `--warning*`, `--danger*` |
| The font | `--font-sans` (and `--font-heading` if headings differ). Inter is listed first and used when installed; otherwise the system font shows. No font file is bundled. To ship a webfont later, add it with `next/font/local` in `src/app/layout.tsx` and put its variable first in `--font-sans` |
| Corner roundness | `--radius` (controls), `--radius-lg` (cards, dialogs), `--radius-pill` |
| Spacing, type sizes | `--space-*`, `--font-size-*` |
| Focus ring | `--focus-ring`, `--focus-offset`, `--focus-color` |
| Animation speed | `--motion-fast` (reduced-motion users get none automatically) |

### Light and dark

Light values are the default. **Dark values are written twice** and must stay identical:

1. inside `@media (prefers-color-scheme: dark)` (follows the visitor's OS setting), and
2. inside `[data-theme='dark']` (forces dark; the style guide uses it).

`npx vitest run src/app/theme.test.ts` fails if the two copies differ, if a light colour token has no dark value, or if a raw
colour appears outside the token blocks.

### Accessibility numbers to keep

When you change a colour, keep these pairs at WCAG AA in **both** modes: text 4.5:1 (`--foreground` and `--muted` on
`--background`, `--surface` and `--surface-2`; `--on-primary` on `--primary`; status text on its `-bg`), and 3:1 for control
borders (`--border-strong` on `--surface`) and the focus ring (`--focus-color` on `--background`). The current values were
checked against these, with the lowest text ratio at 4.99:1 (warning text on its tint).

## Token list

**Colour** (light and dark values): `--background` `--surface` `--surface-2` `--border` `--border-strong` `--foreground`
`--muted` `--primary` `--primary-hover` `--on-primary` `--primary-soft` `--primary-text` `--focus-color` `--success`
`--success-text` `--success-bg` `--warning` `--warning-text` `--warning-bg` `--danger` `--danger-text` `--danger-bg`
`--on-danger` `--info-bg` `--info-text` `--scrim` `--shadow-popup`

**Type**: `--font-sans` `--font-heading` `--font-weight-normal|medium|bold` `--line-height` `--line-height-tight`
`--letter-spacing-heading` `--font-size-xs|sm|base|lg|xl|2xl`

**Spacing**: `--space-1|2|3|4|6|8|12` (4px steps)

**Shape and layout**: `--radius` `--radius-lg` `--radius-pill` `--border-width` `--page-max-width` `--touch-target` (44px)

**Focus and motion**: `--focus-ring` `--focus-offset` `--motion-fast` `--motion-ease` `--disabled-opacity`

The older names (`--background`, `--foreground`, `--surface`, `--border`, `--muted`, `--primary`, `--danger`, `--space-*`,
`--radius`, `--font-size-*`, `--focus-ring`) still exist and still work.

## Do

- Use the shared components (`Alert`, `Card`, `EmptyState`, `Skeleton`, `ConfirmDialog` via `useConfirm`, `TextField`,
  `StatusBadge`, `PageHeader`, `FormActions`, `DataTable`, `Pagination` ...) before writing your own markup.
- Use the classes that already exist (`.btn`, `.btn-primary`, `.btn-danger`, `.card`, `.table`, `.field`,
  `.grid-cards`, `.page`). Add new rules to `globals.css` next to similar ones.
- Colour, spacing, radius and font come from tokens: `color: var(--muted)`, `padding: var(--space-4)`.
- Use **one** `.btn-primary` per view. Everything else is a plain `.btn`; destructive actions are `.btn-danger`.
- Keep tap targets at least `var(--touch-target)` (44px) and check your screen at 375px wide and at 320px.
- Check your screen in light **and** dark (open `/examples/theme`, or switch your OS setting).
- Let text carry meaning. A status is a word plus a colour, never a colour alone.

## Don't

- No raw colours (`#fff`, `rgb(...)`, `hsl(...)`, named colours) in CSS or TSX. `theme.test.ts` catches them in `globals.css`.
- No inline `style={{ ... }}` for look and feel. The only inline styles allowed are dynamic sizes such as the `Skeleton` width.
- Do not add `prefers-color-scheme` rules for individual components; the tokens already switch.
- Do not add a UI library, Tailwind or a second font.
- Do not use shadows or gradients to create depth; the theme uses hairline borders and whitespace. (`--shadow-popup` is only for
  floating things: pickers and toasts.)
- Do not use animation for decoration. Motion is only for feedback (spinner, skeleton), and it stops under reduced motion.
- Do not rename or remove a token without searching for its uses first (`rg "var\(--the-name\)" src`).

## How the pieces are wired

- No font is downloaded: `--font-sans` names Inter first and falls back to the system font stack, so builds work offline.
- `/examples/theme` renders two panels with `data-theme="light"` and `data-theme="dark"`. Any element with a `data-theme`
  attribute takes that theme's tokens for everything inside it.
