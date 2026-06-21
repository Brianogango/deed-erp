# ERP UI Specification (Quality / Polish Baseline)

This document defines the shared UI contract for the ERP frontend.

## 1) Design tokens

### Color tokens
- Primary: `--primary`, `--primary-dark`, `--primary-light`
- Surfaces: `--bg-page`, `--bg-card`, `--bg-surface`, `--bg-muted`
- Text: `--text-1` to `--text-4`
- Status: `--success`, `--warning`, `--danger`, `--info`
- Status badges (contrast-safe): `--success-bg/text`, `--warning-bg/text`, `--danger-bg/text`, `--info-bg/text`

### Typography tokens
- `--fs-ui`: general UI text
- `--fs-table`: table body text
- `--fs-label`: micro labels and badges
- `--fs-tab`: tabs and compact controls

Breakpoint scale:
- Phone: base values (`:root`)
- Tablet/Laptop: `@media (min-width: 768px)`
- Big screen: `@media (min-width: 1536px)`

### Motion tokens
- `--motion-fast: 180ms`
- `--motion-base: 220ms`
- Use `ease-out` timing for UI transitions.

Reduced motion:
- Respect `prefers-reduced-motion: reduce`.

## 2) Accessibility rules

1. Icon-only buttons **must** have an `aria-label`.
2. Touch targets for icon actions are minimum **44x44**.
3. All interactive controls must expose visible `:focus-visible`.
4. Badge and tab states must maintain readable text/background contrast.

## 3) Component standards

## Tabs
- Use adaptive tab pattern (`TabBar`) without horizontal scroll as default.
- Active state: strong contrast (`primary-dark` + white text).
- Inactive state: neutral background, clear hover/focus state.

## Cards
- Use compact spacing on phones.
- KPI cards use `.kpi-grid-compact` on mobile-first breakpoints.
- Record cards show key metrics first; optional details are hidden until expanded.

## Buttons
- Enforce hierarchy:
  - Primary: one key action per section.
  - Outline/Secondary: supporting actions.
  - Tertiary/Ghost: low emphasis actions.
- Shared interaction behavior:
  - hover, active, focus ring
  - `180ms` transition duration

## Tables
- Use responsive table wrappers (`.responsive-table` / `.erp-responsive-table`).
- Mobile behavior:
  - row-to-card hierarchy
  - hidden secondary cells toggled with Details/Less
  - no mandatory horizontal scrolling for primary data

## Forms
- Inputs/selects use shared `form-input` / `form-select`.
- Error/help text style is consistent across modules.
- Modal forms collapse multi-column grids to single column on small screens.

## 4) State design system

Use shared state primitives from `components/ui`:
- `StatePanel tone="empty"`
- `StatePanel tone="loading"`
- `StatePanel tone="error"`
- `StatePanel tone="success"`
- `StateSkeleton` for async loading placeholders

Required state handling per major view:
1. Loading (skeleton)
2. Empty
3. Error
4. Success feedback

## 5) Visual regression policy

Baseline screenshots are stored under:
- `docs/visual-regression/core/<route>/<breakpoint>.png`

Required routes:
- `/` (dashboard)
- `/sales`
- `/operations`
- `/finance`
- `/hr`
- `/repairs`

Required breakpoints:
- `320`, `375`, `390`, `430`, `768`, `1024`, `1366`, `1920`

Capture command:

```bash
VISREG_BYPASS_AUTH=true npm run dev
VISREG_SKIP_LOGIN=true npm run screenshots:core
```

If auth/database are configured locally, you can instead use normal login mode:

```bash
npm run screenshots:core
```

Environment overrides:
- `VISREG_BASE_URL`
- `VISREG_USERNAME`
- `VISREG_PASSWORD`
- `VISREG_OUT_DIR`
