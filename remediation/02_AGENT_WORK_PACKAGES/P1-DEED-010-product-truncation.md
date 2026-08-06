# P1-DEED-010 — Fix product-name truncation and add full-name disclosure

## 1. Task identity
- **Task ID:** P1-DEED-010 · **Priority:** P1 · **Severity:** High
- **Assigned agent type:** Frontend Agent
- **Related findings:** DEED-010 (Product Quality Audit)
- **Business owner:** n/a · **Technical reviewer:** Tech lead

## 2. Plain-language objective
Product names in tables are wide enough — or wrap, or show a tooltip — so that two different laptops never look identical on screen, preventing staff from picking or quoting the wrong device.

## 3. Confirmed problem
- **Evidence:** Product Quality Audit measured up to 80% of a product name hidden (e.g. "HP OmniBook X Flip 14-fm0013dx 2-In-1, Intel…" showing 186px of 947px needed on After-Sales); truncation counts: Outsource 20, Repairs 20, After-Sales 11, Kilimall 5, HR 4, Holdovers 3; no tooltips present; two different "Dell XPS 13 9310" variants render identically truncated.
- **Reproduction:** open Outsource/Repairs/After-Sales/Kilimall/HR/Holdovers and view any long product name in a data grid.
- **Expected:** identification columns are wide enough (or wrap) to distinguish similar items; a tooltip or accessible disclosure reveals the full name when still truncated.
- **Root cause:** fixed narrow column widths with `nowrap` truncation and no disclosure mechanism, used across the shared `DataTable`.
- **Confidence:** High.

## 4. Scope
- Widen or allow wrap on identification (product/device name) columns in the shared `DataTable`/column-config for the six named modules.
- Add a tooltip (or accessible `title`/disclosure) exposing the full name whenever truncation still occurs.
- Ensure distinguishing details (model/generation/SKU) are visible or accessible without ambiguity.

## 5. Out of scope
- Redesigning the overall table layout or column set beyond the identification column's width/wrap behavior.
- Changing product data itself (names/SKUs).
- Non-listed modules (may benefit from the same fix later as a natural follow-on, but only the six audited modules are in scope here).

## 6. Likely affected components
- `components/data-table/DataTable.tsx` (or the specific column-rendering logic — `getColumnValue`/cell renderer)
- Column configuration for Outsource, Repairs, After-Sales, Kilimall, HR, Holdovers modules (locate each module's column definitions — likely inline `ColumnDef` arrays per the pattern seen in `components/modules/Inventory.tsx`'s `catalogColumns`)
- New: a shared truncation-with-tooltip cell renderer, if one does not already exist, added to `lib/data-table/types.ts` or a new small helper

## 7. Implementation instructions
1. Locate the product/device-name column definition in each of the six named modules.
2. Increase the column's minimum width or switch from a fixed `px` width to a fluid `minmax()`/`fr` unit (consistent with `estimateTableMinWidth`'s existing fluid-column handling already present in `DataTable.tsx`), allowing more room before truncation kicks in.
3. Where two-line wrap is acceptable without harming table readability (assess per module — dense tables with many rows may prefer a tooltip-only approach; sparser tables may afford a wrap), allow `white-space: normal` with a `-webkit-line-clamp: 2` or similar bounded wrap.
4. For any name still truncated after widening, add a native `title` attribute (minimum viable accessible disclosure) or a proper tooltip component if one exists in `components/ui`, showing the full untruncated name.
5. Confirm model/generation/SKU information needed to distinguish similar items is present either in the name itself or an adjacent column/tooltip — if the current data model lacks a distinguishing field for some products, flag this as a data-quality follow-up rather than inventing new data.
6. Re-measure truncation on the six modules per the audit's methodology (visible px vs needed px) and confirm the reported cases (HP OmniBook, Lenovo ThinkPad, two Dell XPS variants) are now either fully visible or clearly disclosed via tooltip.

## 8. Acceptance criteria
- No product-identification cell hides more than 30% of its content without a tooltip/disclosure exposing the full value.
- The two previously-identical-looking "Dell XPS 13 9310" variants are now distinguishable in the grid (via width, wrap, or tooltip).
- All six audited modules (Outsource, Repairs, After-Sales, Kilimall, HR, Holdovers) verified.

## 9. Test plan
- **Measurement test:** re-run the audit's truncation methodology (visible vs needed pixel width) against the six modules; assert improvement/resolution.
- **Visual check:** screenshots of the previously-worst cases, before and after.
- **Manual UAT:** hover/tap a still-truncated name and confirm the full value is disclosed.

## 10. Evidence required from the implementing agent
Summary of changes; exact files; before/after screenshots and pixel measurements for the worst-reported cases; test commands + results; build result; risks (table layout shift affecting other columns — verify no horizontal scroll regression); rollback (column-config revert); unresolved issues (any product genuinely lacking distinguishing data).

## 11. Deployment plan
- **Branch:** `cursor/deed-010-product-truncation-ddc8`
- **Staging:** deploy; verify the six modules against real staging product data.
- **Migrations/env:** none.
- **Smoke test:** view a long product name in each of the six modules; confirm readability or tooltip disclosure.
- **Rollback trigger:** table layout regression (horizontal scroll break, column misalignment) → revert.
