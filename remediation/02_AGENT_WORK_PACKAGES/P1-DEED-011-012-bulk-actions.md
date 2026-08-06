# P1-DEED-011-012 — Fix invoice bulk-action bar (disabled Pay, duplicated controls)

## 1. Task identity
- **Task ID:** P1-DEED-011-012 · **Priority:** P1 · **Severity:** Medium
- **Assigned agent type:** Frontend Agent
- **Related findings:** DEED-011 ("Pay 0 invoices" on an enabled button), DEED-012 (duplicated selected-count/Clear) — kept together as they share the same component and root cause, per the master prompt's guidance for shared-root-cause findings, with separate acceptance criteria retained below
- **Business owner:** n/a · **Technical reviewer:** Tech lead

## 2. Plain-language objective
When a user selects invoices to pay, the Pay button is only clickable when at least one selected invoice can actually be paid, and clearly explains why if not. The selection bar shows the count and a Clear action exactly once, not twice.

## 3. Confirmed problem
- **Evidence:** Product Quality Audit: selecting a DRAFT invoice (KSh 51,700) produced `1 selected · 1 selected · Clear · Download PDF · Pay 0 invoices · Clear` with the Pay button reporting `disabled: false`; selecting a NOT PAID invoice correctly produced `1 selected · 1 payable · KSh 7,000 outstanding … Pay 1 invoice`. The explanatory "payable" clause is suppressed exactly when the count is zero — precisely when it's most needed.
- **Reproduction:** in Finance's invoice grid, select a single DRAFT invoice via checkbox; observe the bulk-action bar.
- **Expected:** Pay disabled with a visible reason when no selected invoice is payable; exactly one selected-count and one Clear control; correct payable count/outstanding total for any selection.
- **Root cause:** the bulk-action bar appears to be composed from two overlapping components/renders duplicating selection-summary state, and the payable-count-zero case omits its explanatory text while leaving the button enabled.
- **Confidence:** High.

## 4. Scope
- Consolidate the invoice bulk-action bar to a single source of selection-summary state (one selected-count, one Clear).
- Disable the Pay action when the payable count (from the current selection) is zero, with visible explanatory text (e.g., "Selected invoices are drafts — post them first").
- Recompute payable count and outstanding total correctly for any mixed selection (some payable, some not).

## 5. Out of scope
- Changing what makes an invoice "payable" (existing business logic, e.g. posted/not-paid status) — only the bar's rendering and button-disabled logic change.
- Any other bulk action beyond Pay/Clear/Download PDF as currently present.

## 6. Likely affected components
- Finance invoice grid / bulk-action bar component (locate exact file — likely within the Finance/Accounting module's invoice list, possibly using `components/data-table/BulkActionsBar.tsx` given the shared `DataTable` system — confirm before editing)
- New: `__tests__/invoice-bulk-actions.test.ts`

## 7. Implementation instructions
1. Locate the bulk-action bar rendering and determine why the selected-count and Clear controls appear twice — likely two components each rendering their own copy of the same summary (a wrapper and an inner component, or a leftover from a previous refactor). Consolidate to one.
2. Locate the payable-count computation; ensure it derives from the current selection's actual payable invoices (posted/not-fully-paid) every time selection changes.
3. Change the Pay button's `disabled` prop to be driven by `payableCount === 0` (currently apparently hardcoded or miscalculated to always be `false`).
4. When `payableCount === 0`, render the explanatory text unconditionally instead of suppressing it — invert whatever condition currently hides it at zero.
5. Verify the outstanding-total calculation sums only the payable subset of the current selection, not the full selection.

## 8. Acceptance criteria (DEED-011)
- Given a selection where no invoice is payable, the Pay button is disabled and a visible reason is shown.
- Given a mixed selection (some payable, some not), Pay is enabled and reflects only the payable subset's count/total.

## 8b. Acceptance criteria (DEED-012)
- The bulk-action bar shows exactly one selected-count indicator and exactly one Clear action, regardless of selection size.

## 9. Test plan
- **Unit:** payable-count/outstanding-total computation for all-draft, all-payable, and mixed selections.
- **E2E:** select a single DRAFT invoice → Pay disabled + reason shown; select a single NOT PAID invoice → Pay enabled with correct count/total; select both → correct mixed behavior.
- **Visual check:** confirm no duplicated selected-count/Clear controls at 1 and 3+ selections (matching the audit's own evidence screenshots).

## 10. Evidence required from the implementing agent
Summary of changes; exact files; before/after screenshots at 1 and 3+ selections, and for all-draft/mixed/all-payable scenarios; test commands + results; build result; risks; rollback (component-level revert); unresolved issues.

## 11. Deployment plan
- **Branch:** `cursor/deed-011-012-bulk-actions-ddc8`
- **Staging:** deploy; test all three selection scenarios against staging invoice data.
- **Migrations/env:** none.
- **Smoke test:** select invoices in each scenario and confirm correct Pay button state and single set of controls.
- **Rollback trigger:** any regression to the payment flow itself (not just the bar's display) → revert immediately, this is finance-adjacent.
