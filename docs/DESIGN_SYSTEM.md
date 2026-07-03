# Deed ERP Design System & Restyle Notes

Presentation-layer reference for the ERP UI. Everything here is implemented as
CSS custom properties in `app/globals.css` and mapped into Tailwind via
`tailwind.config.js`. **No business logic, API, endpoint, or DOM contract was
changed** — see "DOM-contract guarantees" below.

## 1. Design tokens

All tokens live in `:root` in `app/globals.css`.

### Color

| Token | Value | Use |
|---|---|---|
| `--primary` | `#2563EB` | Primary actions, links, focus rings |
| `--primary-dark` | `#1D4ED8` | Primary hover state |
| `--bg-page` | `#F1F5F9` | App background |
| `--bg-card` | `#FFFFFF` | Cards, tables, modals |
| `--bg-surface` | `#F8FAFC` | Secondary surfaces, hovers |
| `--border` / `--border-lt` / `--border-strong` | slate 300/200/400 | Borders by emphasis |
| `--text-1` … `--text-4` | slate 900/800/600/400 | Text hierarchy |
| `--success` / `--warning` / `--danger` / `--info` | green/amber/red/blue 600s | Status + paired `*-bg`/`*-text` badge tokens |
| `--table-head-bg` | `#F8FAFC` | Flat table header surface (replaced gradients) |
| `--sidebar-*` | navy family | Entire sidebar palette (see §4) |

### Typography (fluid, breakpoint-stepped)

| Token | Phone | ≥768px | ≥1536px |
|---|---|---|---|
| `--fs-ui` | 13px | 14px | 15px |
| `--fs-table` | 12px | 13px | 14px |
| `--fs-label` | 10px | 11px | 12px |
| `--fs-tab` | 11px | 12px | 13px |

### Radius

| Token | Value | Tailwind mapping | Use |
|---|---|---|---|
| `--radius-sm` | 0.5rem | `rounded-token-sm` | Buttons, chips |
| `--radius-md` | 0.75rem | `rounded-token-md` | Inputs, nav items |
| `--radius-lg` | 1rem | `rounded-token-lg` | Cards, tables, modals |
| `--radius-full` | 999px | `rounded-full` | Pills, badges |

### Elevation

| Token | Tailwind class | Use |
|---|---|---|
| `--shadow-xs` | — | Table containers |
| `--shadow-sm` | `shadow-card` | Cards |
| `--shadow-md` | `shadow-glass` | Floating menus |
| `--shadow-lg` | — | Overflow menus, popovers |
| `--shadow-modal` | `shadow-modal` | Modals/dialogs |

### Motion

`--motion-fast` (180ms) for hovers/micro-interactions, `--motion-base` (220ms)
for panel/card transitions. A global `prefers-reduced-motion` block collapses
all animation to 1ms.

### Z-index scale

Documented in `globals.css` (modal section): sidebar backdrop `40` → topbar
`100` → modals `9000` → confirm `9100` → account panel `9150` → dropdowns in
modals `9300` → toasts `9999`.

## 2. Breakpoints

Defined in `tailwind.config.js`: `sm` 480 / `md` 768 / `lg` 1024 / `xl` 1280 /
`2xl` 1536, plus `max-*` desktop-first caps. Responsive behaviors:

- **Sidebar**: off-canvas drawer < 768px (backdrop + body-scroll lock), icon
  rail or full rail ≥ 768px.
- **Tables**: three patterns, all preserving row actions and identifiers:
  - `<table>` → auto-upgraded to `erp-responsive-table` (stacked label/value
    cards < 640px, with per-row Details toggle);
  - grid tables (`.table-head`/`.table-row`) → `responsive-table` stacking;
  - wide analytical reports → `dt-wrap`/`dt-scroll` horizontal-scroll
    containers with styled thin scrollbars.
- **Modals**: full-width cards < 768px, multi-column form grids collapse to
  one column, action rows stack full-width < 480px.
- **Stat grids**: `stat-grid-3/4/5` collapse 2-up then 1-up under 360px.

## 3. Old style → token mapping (this pass)

| Before | After | Files |
|---|---|---|
| Table headers: `linear-gradient(180deg,#F8FAFC,#EEF2F7)` ×3 | flat `var(--table-head-bg)` | `globals.css` |
| Table header text `--text-4` (#94A3B8, fails 4.5:1) | `--text-3` (#475569, WCAG AA) | `globals.css` |
| `.btn-primary:hover` `filter: brightness(.94)` | `background: var(--primary-dark)` | `globals.css` |
| `.btn-danger:hover` `filter: brightness(.95)` | `background: #B91C1C` (red-700) | `globals.css` |
| Literal shadows in `.table-scroll`, `.dt-wrap`, `.dt-scroll`, `.tab-overflow-menu`, `.modal-box` | `var(--shadow-xs/-lg/-modal)` | `globals.css` |
| Sidebar inline hex styles + JS `onMouseEnter/onMouseLeave` hover | `.sidebar-shell`, `.sidebar-nav-item(.active)`, `.sidebar-collapse-btn`, `.sidebar-tooltip`, `.sidebar-group-*` classes on tokens | `globals.css`, `Sidebar.tsx` |
| Sidebar pin `★` button (11px text target) | `.sidebar-pin-btn` 28px target + hover surface | `globals.css`, `Sidebar.tsx` |
| Toast icons as text glyphs (✓ ✕ ℹ) | inline SVG (Feather-style), `role="status"` + `aria-live="polite"` added | `components/ui/index.tsx` |
| Tailwind `shadow-card/glass/modal` literal values | reference the shadow tokens | `tailwind.config.js` |

## 4. DOM-contract guarantees

- **No element IDs, `name` attributes, or `data-*` attributes were renamed or
  removed.** The responsive-table machinery (`data-label`,
  `data-mobile-extra`, `data-no-responsive`, `data-table-density`) is
  untouched.
- **No selectors were renamed.** All new sidebar classes (`sidebar-*`) are
  additions; the original element structure, `Link href`s, `onClick`
  handlers, pin/keyboard-shortcut logic and badge rendering in `Sidebar.tsx`
  are byte-for-byte preserved except for `className`/`style` attributes.
- **Removed JS was purely presentational**: the deleted
  `onMouseEnter`/`onMouseLeave` handlers only mutated inline hover colors;
  identical behavior is now in `:hover` CSS (which also fixes "hover style
  sticks after tap" on touch devices).
- **No endpoints, form submissions, validation, or store logic touched.**

## 5. QA checklist

Run through at 375px, 768px, 1024px and 1440px in Chrome, Firefox and Safari
(+ one iOS and one Android device):

1. **Login** → sign in, wrong-password error, lockout message.
2. **Sidebar** — expand/collapse (desktop), drawer open/close via topbar
   hamburger + backdrop tap (mobile), active state follows route, hover
   highlight, pin/unpin persists after reload, Alt+1…n jumps to pinned
   modules, badge count on Repairs.
3. **Tables** (Sales, Operations, Finance) — desktop: hover rows, sort
   indicators, horizontal scroll on wide reports; mobile: stacked cards show
   labels, "Details/Less" toggle reveals hidden columns, row actions still
   fire.
4. **Forms & modals** — open a Sale/Repair/Contact modal: focus is trapped,
   Esc closes, fields keyboard-reachable, grids collapse to one column on
   mobile, submit paths unchanged.
5. **Toasts** — success/error/info render with icon, auto-dismiss progress,
   screen reader announces (aria-live).
6. **Exports** — PDF/Excel export buttons on any module still download.
7. **No horizontal page scroll** at any breakpoint; focus rings visible when
   tabbing; buttons ≥ 44px touch targets on mobile.

## 6. Visual regression

`npm run screenshots:core` (`scripts/capture-visual-regression.mjs`) captures
6 core routes × 8 viewports (320→1920) into `docs/visual-regression/core/`.
It now **requires** `VISREG_USERNAME`/`VISREG_PASSWORD` env vars (credentials
were removed from source). Capture on the base branch, re-capture on this
branch, and diff the folders.

## 7. Rollback

All changes are presentation-only and grouped in one commit — `git revert
<commit>` restores the previous look with zero data/schema impact. Individual
pieces can also be reverted per-file (`globals.css`, `tailwind.config.js`,
`Sidebar.tsx`, `components/ui/index.tsx`) without breaking each other, except
the `sidebar-*` classes in `globals.css` which pair with `Sidebar.tsx`.
