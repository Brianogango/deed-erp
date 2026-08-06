# P1-DEED-007 — Separate purchase-order document type from lifecycle status

## 1. Task identity
- **Task ID:** P1-DEED-007 · **Priority:** P1 · **Severity:** High
- **Assigned agent type:** Frontend Agent
- **Related findings:** DEED-007 (Product Quality Audit)
- **Business owner:** n/a · **Technical reviewer:** Tech lead

## 2. Plain-language objective
The Purchases filter tells the truth: if there are 22 purchase orders, the "POs" filter shows 22, not zero.

## 3. Confirmed problem
- **Evidence:** Product Quality Audit: the filter bar shows `All (22) · RFQs (0) · POs (0) · Received (22)` while every visible row has Type = "PO" (programmatic tally `{"PO": 20}` on page 1 of 22 records). The facet conflates document *type* (RFQ vs PO) with lifecycle *status* (e.g. Received), so selecting "POs" — intending "show me purchase orders" — returns zero because the underlying logic is actually checking a status value that happens not to equal "PO".
- **Reproduction:** open Purchases, note the facet counts vs the visible rows.
- **Expected:** independent Type facet (RFQ, PO) and Status facet (Draft, Sent, Partially Received, Received, Cancelled), with each facet's count matching what selecting it actually shows.
- **Root cause:** single facet control mixing two distinct dimensions.
- **Confidence:** High.

## 4. Scope
- Split the current single Purchases filter into two independent facets: **Type** (RFQ, PO) and **Status** (Draft, Sent, Partially Received, Received, Cancelled).
- Compute every displayed count from the same filtered dataset that is rendered to the user (no separately-computed count that can drift from the visible rows).
- Add a test asserting displayed row count matches the selected facet's count for every combination.

## 5. Out of scope
- Changing what a "PO" vs "RFQ" *is* in the data model (no schema change — this is a display/filter-logic fix only, unless the current data model has no way to distinguish type from status at all, in which case the minimal necessary field addition is in scope but must be flagged in the evidence report as a deviation).
- Any other Purchases module feature.

## 6. Likely affected components
- Purchases module component (locate exact file — likely `components/modules/purchase/` directory based on the repo's module structure; confirm before editing)
- Any shared filter/facet component used by Purchases (check `components/data-table/` for a shared filter primitive, consistent with other modules' patterns, before building a bespoke one)
- New: `__tests__/purchases-filter-counts.test.ts`

## 7. Implementation instructions
1. Locate the exact current filter implementation and confirm how "Type" and "Status" are currently represented in the underlying PO/RFQ data (a single field being overloaded, or two fields with the UI only exposing one incorrectly).
2. Build two independent filter controls: Type (All, RFQ, PO) and Status (All, Draft, Sent, Partially Received, Received, Cancelled), each maintaining its own selection state, combinable (AND logic — e.g. Type=PO AND Status=Received).
3. Compute each facet's displayed count by applying the *other* facet's current selection first, then counting — so counts update contextually and always match what selecting that option would show (this mirrors the pattern likely already used elsewhere in `components/data-table/`, per `PrimaryFilterConfig` — reuse that shared pattern rather than inventing a new one, consistent with how `lib/inventory/product-filters.ts` and the Inventory module already do this).
4. Verify against the reported case: with Type=PO selected, the count must show 22 when 22 PO-type records exist, regardless of their status.

## 8. Acceptance criteria
- Type and Status are independent, combinable facets.
- Every facet count equals the number of rows shown when that facet value is selected (verified for every combination in the test).
- The originally reported scenario (22 POs, "POs (0)") no longer reproduces.

## 9. Test plan
- **Unit:** facet-count computation for representative combinations.
- **E2E:** select each Type/Status combination; assert displayed row count matches the facet's own displayed count.
- **Manual UAT:** walk through the Purchases screen with real data and confirm counts make sense.

## 10. Evidence required from the implementing agent
Summary of changes; exact files; before/after screenshots of the filter bar; test commands + results; build result; risks; rollback (component-level revert); unresolved issues (note if a data-model field had to be added, per §5's deviation clause).

## 11. Deployment plan
- **Branch:** `cursor/deed-007-purchases-filters-ddc8`
- **Staging:** deploy; verify against staging's real PO/RFQ data.
- **Migrations/env:** none expected; flag if one becomes necessary per §7.1's investigation.
- **Smoke test:** filter by each Type and Status value; confirm counts and rows agree.
- **Rollback trigger:** any regression in Purchases search/filter for other criteria → revert.
