# Design System Master File

> **LOGIC:** When building a specific page, first check `design-system/deed-erp/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.
>
> **Source of truth for live tokens:** `app/globals.css` (`:root` and `[data-theme='dark']`).
> This document mirrors those tokens — do not invent a second palette.

---

**Project:** Deed ERP  
**Updated:** 2026-08-01  
**Category:** B2B SaaS ERP (inventory, sales, accounting, repair)

---

## Global Rules

### Color Palette (live CSS variables)

| Role | Hex (light) | CSS Variable |
|------|-------------|--------------|
| Primary | `#2563EB` | `--primary` |
| Primary dark | `#1D4ED8` | `--primary-dark` |
| Primary light | `#DBEAFE` | `--primary-light` |
| Navy (brand) | `#1A1F5E` | `--navy` |
| Cyan accent | `#00B0D7` | `--accent-cyan` |
| Page background | `#F1F5F9` | `--bg` / `--bg-page` |
| Surface | `#F8FAFC` | `--bg-surface` |
| Card | `#FFFFFF` | `--bg-card` |
| Text primary | `#0F172A` | `--text-1` |
| Text secondary | `#1E293B` | `--text-2` |
| Text muted | `#475569` | `--text-3` |
| Text subtle | `#64748B` | `--text-4` |
| Border | `#CBD5E1` | `--border` |
| Success | `#059669` | `--success` |
| Warning | `#D97706` | `--warning` |
| Danger | `#DC2626` | `--danger` |
| Info | `#2563EB` | `--info` |

**Do not** hardcode module accent hexes (`#4F46E5`, `#8B5CF6`, `#0891B2`) — use `--primary`, `--navy`, or `--info`.

### Typography

- Prefer the app’s existing UI scale (`--fs-ui`, `--fs-table`, `--fs-label`, `--fs-tab`) from `globals.css`.
- Body / UI: system stack already applied in the ERP shell (do not introduce a second marketing font in product modules).
- Minimum readable size on mobile: 16px for primary inputs where practical; table density may use `--fs-table`.

### Spacing

| Token | Value | Usage |
|-------|-------|-------|
| `--space-1` | `4px` | Tight gaps |
| `--space-2` | `8px` | Icon gaps |
| `--space-3` | `12px` | Compact padding |
| `--space-4` | `16px` | Standard padding / `--page-gutter` |
| `--space-6` | `24px` | Section gaps |
| `--space-8` | `32px` | Large gaps / `--page-gutter-lg` |

### Radius & elevation

| Token | Value |
|-------|-------|
| `--radius-sm` | `0.5rem` |
| `--radius-md` | `0.75rem` |
| `--radius-lg` | `1rem` |
| `--shadow-sm` / `--shadow-md` / `--shadow-lg` | see `globals.css` |

---

## Component Specs

### Buttons

- Use `.btn-primary`, `.btn-secondary`, `.btn-outline`, `.btn-danger` from `globals.css`.
- One primary action per viewport — use `PrimaryActionButton` + `SecondaryActionMenu` for overflow.
- Disable + show “Saving…” / “Charging…” during async mutations.
- Cursor pointer on all clickable controls.

### Icon-only controls

- Use `.icon-btn` or `.row-action-btn` (min **44×44px**).
- Always set `aria-label` (not title-only).
- Icons: Font Awesome via `@/components/icons` — **no emoji as UI icons**.

### Status

- Use shared `StatusBadge` / `Badge` with semantic status keys.
- Do not invent local Tailwind status pills or `STATUS_BADGE` class maps per module.

### Module chrome

- Prefer `ModuleHeader` + `TabBar` + `mod-body`.
- Prefer `TablePageLayout` + `DataTable` for lists.
- Prefer `RecordHeader` / smart buttons for document detail.
- **Inventory pilot:** see `design-system/deed-erp/pages/inventory.md` (Operate mode; navy command chrome).
- **Sales pilot:** see `design-system/deed-erp/pages/sales.md` (Operate mode; slate-ink + emerald pipeline chrome).

### Forms

- Every input has a visible `<label>` / `Field` (not placeholder-only).
- Mark required fields clearly.
- Validate on blur where practical; always show errors near the field.

---

## UX Priorities

1. Accessibility — contrast ≥ 4.5:1, visible focus, keyboard order
2. Touch — 44px targets, 8px+ gaps between actions
3. Performance — skeletons for async lists, respect `prefers-reduced-motion`
4. Consistency — same chrome/status/icons across modules

### Avoid

- Emoji as icons
- Dark mode by default for product modules
- Purple/indigo decorative accents outside brand tokens
- Multiple equal-weight primary buttons in one toolbar
- Cards for non-interactive decoration in dense ERP tables

---

## Pre-Delivery Checklist

- [ ] No emojis as icons (Font Awesome / SVG only)
- [ ] `cursor-pointer` on clickable elements
- [ ] Hover/focus transitions 150–300ms
- [ ] Light mode text contrast AA
- [ ] Focus rings visible
- [ ] `prefers-reduced-motion` respected
- [ ] Responsive at 375 / 768 / 1024 / 1440
- [ ] Async actions disabled while in flight
- [ ] Status via `StatusBadge` / `Badge`
- [ ] Colors from `globals.css` tokens only
