# Emil Kowalski skill collection — compliance report (Deed ERP UI/UX pass)

Scope: presentation layer only. Branch `claude/jolly-ptolemy-wylhv8`, based on `master` at `dd492bc`.
Method: read every installed skill in full → audit the **rendered** app (31 routes × 1440px and 390px, plus
shared-component harnesses) → fix at the shared layer → re-measure.

## 1. Skills discovered

Source: `skills-lock.json` (`emilkowalski/skills`), `.agents/skills/` (symlinked into `.claude/skills/`),
`~/.claude/skills`, `.cursor/skills`. Every file of every skill was read, including `RECIPES.md`, `STANDARDS.md`,
`AUDIT.md`, `PLAN-TEMPLATE.md`, `CATALOG.md`, `PICKER.md`, `API.md`.

| # | Skill | Applicable to Deed ERP? | Why |
|---|---|---|---|
| 1 | `apple-design` | **Yes** | Type, restraint, feedback, reduced motion / transparency / contrast, materials guidance |
| 2 | `emil-design-eng` | **Yes** | Component craft, review checklist, press feedback, hover gating, easing |
| 3 | `animate` (+ `RECIPES.md`) | **Yes, as a gate** | The frequency gate decides *not* to add motion in financial workflows; tokens/curves |
| 4 | `review-animations` (+ `STANDARDS.md`) | **Yes** | Ten standards applied to the existing motion |
| 5 | `improve-animations` (+ `AUDIT.md`, `PLAN-TEMPLATE.md`) | **Yes** | Eight-category audit of every keyframe / transition. Its "plans only, never edit" rule is superseded here by the task, which asks for implementation |
| 6 | `find-animation-opportunities` | **Yes (restraint)** | Gate applied; conclusion is that the ERP needs *less* motion, not more |
| 7 | `animation-performance` | **Yes** | `transition: all`, layout-property animation, blur cost |
| 8 | `break-ui` (+ `CATALOG.md`) | **Yes** | Worst-case data on shared components and tables |
| 9 | `mobile-native` | **Yes** | PWA-style shell: tap highlight, input zoom, touch targets, theme-color, hover gating |
| 10 | `animation-vocabulary` | Reference only | A glossary for naming effects; nothing to build |
| 11 | `pick-ui-library` | **No** | Explicit-invoke lookup; adopting libraries would change dependencies (out of scope) |
| 12 | `prototype` | **No** | Divergence tool for new UI; this is a refinement of an approved design |
| 13 | `ask-sonner` | **No** | Sonner is not used (no dependency, no import) |
| 14 | `animate-expo` | **No** | No React Native / Expo in the repo |
| 15 | `write-swift` | **No** | No Swift in the repo |

Duplicates noted, not changed: the user-level `apple-design` copy is byte-identical to the project copy;
`.cursor/skills` holds older copies of six of these skills (not read by Claude Code).

## 2. Implementation matrix

| Skill | Relevant ERP elements | Improvements identified | Changes applied | Validation |
|---|---|---|---|---|
| apple-design | Type scale, status badges, feedback, accessibility media queries | Text below 11px on every route (452 nodes at 1440, 367 at 390); no `prefers-reduced-transparency` / `prefers-contrast` handling; weak press feedback | `--fs-label`/`--fs-micro` = 11px floor (270 CSS declarations + Tailwind `text-[8–10.5px]` utilities); reduced-transparency and contrast fallbacks; `.btn:active` → `scale(.97)` | Crawl: sub-11px text 452 → 5 (1440) / 367 → 9 (390) |
| emil-design-eng | Buttons, cards, form controls, dashboards | KPI/POS/dashboard cards lifted on hover (7 rules + `StatCard`); invalid inputs had no visual state; Tailwind `hover:` utilities fire on touch | Hover lifts removed from data the user reads/acts on; `aria-invalid` border + ring; `future.hoverOnlyWhenSupported` | Rule-level diff; visual check |
| animate | Whole app (gate) | Accounting dashboard entrance 520ms + up to 450ms stagger on a screen opened many times a day | 220ms `--ease-out`, delay compressed ×0.15; progress fill 650 → 300ms; shared `--ease-out / --ease-in-out / --ease-drawer` tokens; 6 near-duplicate curves consolidated; 43 bare `ease-out` → token | Computed styles |
| review-animations | All CSS animation / transition | `transition: all` (Tailwind `transition-all` ×104), durations >300ms (2), ungated hover motion | `.transition-all` narrowed to paint/composite properties (+`width` for progress bars); durations fixed; floating-assistant hover gated | Grep: 0 `scale(0)`, 0 `ease-in`, no UI-chrome transition >300ms (OTP login loops excepted) |
| improve-animations | Same, eight categories | Findings recorded in §5; no plans files needed because fixes were applied | — | — |
| find-animation-opportunities | Whole app | Candidates all rejected by the gate (keyboard/100+-per-day, functional data) | **No motion added** | Documented in §4 |
| animation-performance | Tailwind utilities, backdrop blur | `transition: all`; 8 `backdrop-filter` surfaces with no opt-out | Property lists narrowed; `prefers-reduced-transparency` removes blur | — |
| break-ui | `RecordCard`, `StatCard`, `Badge`, `PanelHeader`, `DataTable` | At 320px with realistic worst-case data: `RecordCard` overflowed the viewport (amount/status/metadata off-screen); `StatCard` clipped "KSh 12,345,678,90…"; names cut with no way to read them | Cards contained (`min-w-0`); amounts wrap, never truncate; names wrap to 2 lines with `title`; metadata `title` | Harness screenshots before/after |
| mobile-native | App shell, forms, topbar | Inputs <16px (iOS zooms the page; Settings 27/27); 36px topbar buttons; closed sidebar bleeding a shadow; single `theme-color` not matching the white topbar; hover-only utilities | 16px inputs on touch; 44px topbar/row controls; hit-area expansion on sidebar pin; `touch-action: manipulation`; `user-select:none` on controls only; `theme-color` per scheme; shadow removed when closed | Crawl at 390px: inputs <16px 40 → 1, targets <40px 116 → 31 |
| animation-vocabulary | — | — | Used only to name effects in this report | — |

Module defects found by *viewing* rendered screens (not detectable by metrics):

| Module | Defect | Fix |
|---|---|---|
| Delivery + 17 other `PrimaryActionButton` uses without an icon | Mobile primary action was a blank coloured square (label hidden, no icon) | Label hidden only when an icon exists |
| Sales (mobile) | "+" action stretched to 118×74; empty-state card overflowed its panel by 19px | 44×44 action (cascade conflict resolved); wrapper margins reset |
| Expenses and every DataTable in a ~480–767px card | Filters / More stretched to half-width buttons under the search | Container query: one row once the toolbar has room |
| All mobile pages | Grey shadow along the left edge | Closed sidebar casts no shadow |
| Accounting dashboard | 8–9px tables, money left-aligned (previous task) + 520ms entrance | See above |

## 3. Adaptations and exclusions

| Recommendation | Decision | Reason |
|---|---|---|
| apple-design §12 translucent materials / blur / vibrancy | **Excluded** | `design-system/MASTER.md` forbids glassmorphism; dense financial UI needs opaque surfaces. Only the *opt-out* (reduced transparency) was applied |
| Springs, drag-to-dismiss, momentum, rubber-banding | **Excluded** | No gesture-driven surfaces in the ERP; adding them is new interaction, not refinement |
| Stagger/scroll-reveal/delight motion | **Excluded** | ERP motion dial is 2/10; high-frequency financial workflows |
| Press feedback `scale(.97)` | **Adapted** | Applied to buttons (≤160ms, tokenised); not to table rows or list cards |
| Hover lift on cards | **Removed** | Decoration on data the user reads (emil-design-eng "function" test) |
| Toasts: keyframes → transitions | **Not implemented** | Needs mount/unmount state changes in the Toast component (logic) — documented below |
| `viewport-fit=cover` + safe-area insets | **Not implemented** | Cannot be validated without a physical device; risky for the existing fixed bars |
| `pick-ui-library` (Virtuoso, cmdk, base-ui) | **Not applied** | New dependencies are out of scope |
| Brand | **Preserved** | Navy/cyan tokens, Roboto Flex/Open Sans, DM Mono untouched |

## 4. Shared components and tokens changed

- Tokens (`app/globals.css`): `--fs-label` 11px, `--fs-micro`, `--ease-out`, `--ease-in-out`, `--ease-drawer`.
- Baseline section appended to `globals.css` ("ERP BASELINE"): legibility floor for Tailwind micro sizes, touch rules,
  16px inputs, narrowed `transition-all`, reduced-transparency, `prefers-contrast`, `aria-invalid`, DataTable toolbar container query.
- `components/ui` — `StatCard`, `RecordCard` (containment, wrapping, titles, no hover lift).
- `components/erp/PrimaryActionButton` — label hidden only when an icon exists.
- `app/layout.tsx` — `theme-color` per colour scheme.
- `tailwind.config.js` — `future.hoverOnlyWhenSupported`.
- Previous task (already on master): master table system, `fit.ts`, `.erp-table`.

## 5. Audit coverage

31 application routes at 1440 and 390px (`/`, `/my-work`, `/sales`, `/inventory`, `/finance`, `/contacts`, `/crm`, `/pos`,
`/purchases`, `/delivery`, `/repairs`, `/aftersales`, `/reconfiguration`, `/refurbishment`, `/outsource`, `/hr`,
`/expenses`, `/cashbook`, `/deposits`, `/holdovers`, `/kilimall`, `/ecommerce`, `/property`, `/documents`,
`/operations`, `/sops`, `/sop-documents`, `/settings`, `/finance/loans`, `/finance/recurring-bills`,
`/account/password-change`), measured for sub-11px text, undersized targets, inputs that trigger iOS zoom, clipped text,
horizontal overflow and page errors, and reviewed visually in contact sheets. Zero page errors and zero horizontal
overflow before and after.

| Metric (31 routes) | 1440 before → after | 390 before → after |
|---|---|---|
| Text nodes under 11px | 452 → 5 | 367 → 9 |
| Inputs under 16px | 48 → 97 *(desktop keeps compact inputs by design; 16px applies to touch)* | 40 → 1 *(of 53)* |
| Targets under minimum size | 98 → 157 *(sidebar pin buttons, 24px box with an enlarged hit area)* | 116 → 31 |
| Horizontal overflow routes | 0 → 0 | 0 → 0 |
| Page errors | 0 → 0 | 0 → 0 |

The desktop totals rose because the later runs had warm compile caches and hydrated far more content within the same
wait (inputs rendered 48 → 97, targets 1,214 → 1,590); the proportions, not the raw counts, are the comparison.

Remaining 390px items: 1 input and 31 targets, dominated by compact in-card text buttons (about 28px tall).

## 6. Regression testing

- `vitest`: 469 files, 3,551 tests — all pass.
- `tsc --noEmit`: 35 errors, all in `e2e/` and identical on `master` (pre-existing); none elsewhere.
- `next build`: webpack compile succeeds; the type-check step stops on the same pre-existing `e2e/` errors.

## 7. Business logic is unchanged

Files changed: `app/globals.css`, `components/erp/mobile-chrome.css`, `components/erp/mobile-operational.css`,
`components/modules/odoo-record-designs.css`, `components/sales-prototype/sales-prototype.css`, `app/layout.tsx`,
`components/erp/PrimaryActionButton.tsx`, `components/ui/index.tsx`, `tailwind.config.js`, plus this doc and screenshots.

The complete non-CSS diff is `className` strings, `title` attributes, the viewport `themeColor` metadata, one
conditional on whether a button label gets a responsive class, and one Tailwind config flag. Nothing under `lib/`,
`app/api/`, `prisma/`, `middleware.ts`, stores, handlers, validations, calculations or numbering is touched.

## 8. Not done — needs a separate decision

| Item | Why it was left |
|---|---|
| Float artefacts such as `0.30000000000000004` reaching the UI | Number formatting belongs to the data layer; the UI only shows what it is given |
| Toast and modal keyframes → transitions | Requires mount/exit state in components |
| Unifying module headers (title size/subtitle/icon differ per module) | Needs a design decision per module; large refactor |
| `viewport-fit=cover` and safe-area handling | Needs verification on hardware |
| Populated-data states of module-specific screens | No database in this environment; verified empty states, shared components and harnesses only |
| Stale `.cursor/skills` copies | Not used by Claude Code; no change made |
