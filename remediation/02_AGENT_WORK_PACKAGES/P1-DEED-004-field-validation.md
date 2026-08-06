# P1-DEED-004 — Bind validation errors to their fields

## 1. Task identity
- **Task ID:** P1-DEED-004 · **Priority:** P1 · **Severity:** High
- **Assigned agent type:** Frontend/Accessibility Agent
- **Related findings:** DEED-004 (Product Quality Audit); depends on DEED-002/003 groundwork
- **Business owner:** n/a · **Technical reviewer:** Tech lead

## 2. Plain-language objective
When someone submits a form with a mistake, they see exactly which box is wrong and why, right next to it — not just a generic error message somewhere else on the screen.

## 3. Confirmed problem
- **Evidence:** Product Quality Audit measured `aria-invalid = 0` on failed submit across the tested flows; no `aria-invalid`/`aria-describedby` pattern found in a repo-wide search of form components. Errors currently surface only as a toast notification, disconnected from the offending field.
- **Reproduction:** submit the repair-intake form (or any form) with a required field empty — a toast appears; no visual or programmatic indicator on the field itself.
- **Expected:** an inline error message appears adjacent to the invalid field, the field carries `aria-invalid="true"`, the message is linked via `aria-describedby`, and focus moves to the first invalid field (or an error summary).
- **Root cause:** no shared field-error rendering pattern exists in `components/ui`.
- **Confidence:** High.

## 4. Scope
- Extend the shared `Field`/`Input` (and equivalent select/textarea) components in `components/ui` to accept an `error` prop that renders an inline message, sets `aria-invalid`, and wires `aria-describedby` to the message's id.
- On failed submit, move focus to the first invalid field.
- Preserve all previously entered data on a failed submit (no form reset).
- Retain the existing toast as supplementary, non-primary feedback.
- Apply the pattern to: repair intake, contact create/edit, sales quotation, and journal-entry forms (the four forms named across the audits and this brief) as the initial rollout; document the pattern so other forms can adopt it incrementally.

## 5. Out of scope
- Rewriting form state management or validation logic itself — this package changes how validation *results* are displayed, not how they are computed (unless a form currently has no field-level validation result at all, in which case the minimal validation check needed to produce a field-level error is in scope for that field only).
- Applying the pattern to every form in the application in this package (four named forms; broader rollout is a natural P2 follow-up using the now-shared component).
- Removing the toast notification system.

## 6. Likely affected components
- `components/ui/index.tsx` (shared `Field`, `Input`, and related form primitives — confirm exact export names before editing)
- Repair intake form component (locate exact path via the repair-intake submit handler)
- Contact create/edit form (`components/modules/Contacts.tsx` or its modal component)
- Sales quotation form (locate exact path)
- Accounting journal-entry form (`components/modules/Accounting.tsx` or its dedicated component)
- New: `__tests__/field-validation-a11y.test.ts` (or extend an existing a11y test file)

## 7. Implementation instructions
1. Read the current `Field`/`Input` component definitions in `components/ui/index.tsx` in full before changing them, to preserve their existing prop contract for all current callers (this component is used app-wide — a breaking change here would be a broad, unrelated refactor, which is explicitly disallowed).
2. Add an optional `error?: string` prop. When present: render a `<p id="{fieldId}-error" role="alert">{error}</p>` immediately below the field, add `aria-invalid="true"` and `aria-describedby="{fieldId}-error"` to the input element. When absent, render nothing extra and omit both ARIA attributes (do not set `aria-invalid="false"` — omitting is the correct pattern per WAI-ARIA).
3. In each of the four target forms, locate the existing submit-validation logic (do not rewrite it — wrap it). Where a field fails validation, pass its message into the corresponding `Field`'s new `error` prop instead of (or in addition to, for now) triggering the toast.
4. After a failed submit, call `.focus()` on the first invalid field's DOM node (use a `ref` per field, or a single ref array pattern already common in the codebase — check existing form components for a precedent before introducing a new pattern).
5. Confirm no form clears its state on a failed submit — if any currently does, fix that as part of this package (it is directly required by the acceptance criteria and is the same root component).
6. Keep the toast as a secondary confirmation ("Please fix the highlighted fields") rather than the primary error-delivery mechanism.

## 8. Acceptance criteria
- On a failed submit of any of the four target forms, each invalid field shows an inline message immediately adjacent to it.
- Each invalid field has `aria-invalid="true"` and `aria-describedby` pointing to its error message.
- Focus moves to the first invalid field after a failed submit.
- Previously entered valid data is preserved after a failed submit.
- The pattern is implemented once in the shared `Field`/`Input` component and reused by all four target forms (not four separate implementations).

## 9. Test plan
- **Unit:** `Field` component renders `aria-invalid`/`aria-describedby` correctly when `error` is set/unset.
- **Accessibility:** axe-core (or equivalent) run against each of the four forms in an invalid-submit state — zero new violations related to 3.3.1/4.1.2.
- **E2E:** submit each form invalid → assert inline error visible, focus on first invalid field, data preserved.
- **Manual UAT:** keyboard-only walkthrough of each form's error state; screen-reader spot check if available (full AT coverage is Workstream I, but a basic check here is reasonable).

## 10. Evidence required from the implementing agent
Summary of changes; exact files; before/after screenshots of an invalid submit; axe results; test commands + results; build result; risks (shared component change blast radius — confirm no visual regression on existing valid-state forms); rollback (component change is additive via optional prop; safe single-commit revert); unresolved issues (which forms remain unmigrated).

## 11. Deployment plan
- **Branch:** `cursor/deed-004-field-validation-ddc8`
- **Staging:** deploy; manually exercise all four target forms plus a sample of other forms using the same shared component to confirm no visual regression.
- **Migrations/env:** none.
- **Smoke test:** submit each target form both validly and invalidly.
- **Rollback trigger:** shared component change causes a layout regression on an unrelated form → revert; the `error` prop is additive so risk is low.
