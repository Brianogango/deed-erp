# ERP UX Phase 4–5 closure

Phase 4 and Phase 5 implementation baseline is complete on `ux/phase4-phase5-mobile-accessibility`, stacked on `ux/phase2-phase3-consistency`.

## Phase 4 — responsive/mobile closure

Implemented baseline:
- `ResponsivePageContainer` contains wide children without allowing page-level horizontal drift.
- `PageToolbar` is phone-first: search can occupy its own row, filters/actions wrap, and control groups remain usable at narrow widths.
- `TablePageLayout` contains dense table/list surfaces locally.
- `MobileActionBar` provides a shared phone action dock with safe-area padding and touch-safe controls.
- Purchase GRN detail adopts the phone action dock for its primary `Process GRN` action and label-print secondary action.
- Purchase receipt/bill actions use larger mobile touch targets while retaining compact desktop behavior.
- Existing AppShell mobile drawer scroll locking and local table responsiveness remain intact.

## Phase 5 — navigation/accessibility closure

Implemented baseline:
- `AccessibleIconButton` guarantees an accessible name, title, visible focus ring and a 44px minimum target.
- `ModuleChrome` exposes each active workspace as a named region.
- `TablePageLayout` exposes titled operational list regions to assistive technology.
- Purchase receipt and bill directories expose named sections; receipt Open actions have record-specific accessible labels.
- CRM sales heatmap exposes a concise screen-reader chart summary instead of hundreds of unlabeled visual cells.
- Existing AppShell skip-to-content behavior, Sidebar `aria-current`, grouped navigation semantics and drawer `aria-hidden`/`inert` behavior are preserved.
- Existing route-history/state behavior and permissions are unchanged.

## Compatibility decisions

Large high-risk modules were not rewritten solely to satisfy this phase when they already consume the shared shell/action/status/table foundations. The closure approach is additive: shared containment, touch/action primitives and accessibility semantics are applied without changing business workflows or permission checks.

## Release gate

Implementation completion is not release verification. Before merge/deployment, run in a clean environment:

```bash
npm run test
npm run typecheck
npm run build
npm run test:e2e
npm run screenshots:core
```

The visual regression command requires working credentials/test data. Do not treat GitHub mergeability as evidence that these commands passed.

## Acceptance checklist

- [x] Shared page containment prevents wide children from forcing the ERP shell sideways.
- [x] Toolbar search/actions wrap predictably on narrow screens.
- [x] Shared phone action dock respects safe-area insets.
- [x] New compact icon actions have accessible names and focus-visible treatment.
- [x] New mobile actions target approximately 44px where practical.
- [x] Module/list regions are named for assistive technology.
- [x] Purchase GRN detail has reachable phone actions.
- [x] Purchase list actions have record-specific accessible labels/touch sizing.
- [x] CRM heatmap has a meaningful nonvisual summary.
- [x] Existing business rules, permissions, security controls and route-state behavior remain unchanged.
- [ ] Unit/integration tests executed and passing.
- [ ] Typecheck executed and passing.
- [ ] Production build executed and passing.
- [ ] E2E suite executed and passing.
- [ ] Visual-regression screenshots captured/reviewed.
