# ERP UX Phase 4–5 — mobile, navigation and accessibility

This branch is stacked on `ux/phase2-phase3-consistency`.

## Phase 4 — mobile and responsive refinement

Goals:
- Prevent page-level horizontal overflow on phone and tablet widths.
- Give search the full available width before secondary toolbar controls wrap.
- Keep operational actions reachable with touch-safe controls and a shared phone action dock.
- Preserve table-local scrolling while preventing a wide child from pushing the entire ERP shell sideways.
- Respect mobile safe-area insets for bottom actions.

Shared baseline:
- `ResponsivePageContainer` now enforces min-width/max-width containment.
- `PageToolbar` is mobile-first: search can take a full row, controls wrap predictably, actions stay usable.
- `TablePageLayout` explicitly contains wide table surfaces without breaking the shell.
- `MobileActionBar` provides a shared bottom action dock for record screens on phones.

## Phase 5 — navigation and accessibility polish

Goals:
- Keep every icon-only action explicitly named.
- Guarantee a minimum 44px touch target for compact icon actions.
- Expose module workspaces and table sections as named regions.
- Preserve the existing shell skip link, `aria-current` sidebar navigation and mobile drawer semantics.
- Keep focus-visible treatment explicit on compact actions.

Shared baseline:
- `AccessibleIconButton` guarantees an accessible name, title, focus ring and touch target.
- `ModuleChrome` exposes the active module workspace as a named region.
- `TablePageLayout` labels table regions from their visible heading when available.
- Existing `AppShell` skip-to-content, mobile body-scroll lock and Sidebar `aria-current` behavior remain intact.

## Rollout order

1. Shared chrome and containment foundation.
2. High-traffic record screens: Sales, Repair, Purchase, Delivery.
3. Dense operational lists: Inventory, CRM, Accounting, HR.
4. Reconfiguration and remaining long-form operational screens.
5. Keyboard/touch/accessibility closure audit.

## Acceptance criteria

- No page-level sideways scrolling at 320, 375, 390, 768 and 1024px reference widths; deliberate table/form scrollers remain local.
- Primary phone actions are reachable without recreating desktop button clusters.
- Interactive controls used on phone have approximately 44px touch targets where practical.
- Icon-only buttons have an accessible name.
- Current navigation is exposed with `aria-current` or the appropriate tab state.
- Named module/list regions are available to assistive technology.
- Keyboard focus is visible for newly introduced compact controls.
- Existing business rules, permissions, security gates and route-state behavior are unchanged.

## Verification before merge

Run in a clean environment:

```bash
npm run test
npm run typecheck
npm run build
npm run test:e2e
```

Also capture the core visual regression set when credentials are available:

```bash
npm run screenshots:core
```
