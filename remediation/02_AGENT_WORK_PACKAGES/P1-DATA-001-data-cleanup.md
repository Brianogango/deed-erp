# P1-DATA-001 — Fix and clean up corrupt references and dates

## 1. Task identity
- **Task ID:** P1-DATA-001 · **Priority:** P1 · **Severity:** Medium
- **Assigned agent type:** Backend Agent + Database Agent (cleanup)
- **Related findings:** DATA-001 (Phase 1)
- **Business owner:** confirms the corrected values for the two known bad records before the cleanup script is applied · **Technical reviewer:** Database review for the migration

## 2. Plain-language objective
References like refund numbers are always valid numbers, never the text "NaN", and dates like a repair's intake date are always sensible — not decades in the future. Two known bad records already in the system get corrected, with the original (wrong) values kept in a safe log in case anyone needs to check what happened.

## 3. Confirmed problem
- **Evidence (Phase 1 audit, 4 Aug 2026):** `deed_refundPayments` contains two records with `ref = "RFD/0NaN"`; `deed_repairs_v2` record `REP-352227` has `date = "2091-04-28"`. Root cause: unvalidated numbering computation (a sequence calculation producing `NaN` under some condition) and unbounded date input (no plausibility check on repair dates).
- **Reproduction:** inspect the two known records; separately, attempt to create a refund or repair with an out-of-range date to confirm no current validation exists.
- **Expected:** references are always well-formed; dates fall within a sensible bound (e.g. not more than a short grace period in the future, not before the business existed).
- **Root cause:** no server-side validation on ref generation or date input for these paths.
- **Confidence:** High (Phase 1 evidence); **note:** confirm these two specific records still exist in current production data as part of this package's first step, since time has passed since Phase 1 — if already corrected, downgrade this package to validation-only.

## 4. Scope
- Add server-side validation preventing any future `NaN` (or otherwise malformed) reference from being persisted.
- Add server-side date-bounds validation on repair intake (and any other date-bearing document creation found to lack it).
- One reviewed, backed-up cleanup script correcting the two known bad records (or documenting that they no longer exist).

## 5. Out of scope
- Broad validation overhaul of every field in every form (targeted to the two confirmed defect classes only).
- Any change to the numbering system's design beyond making it reject `NaN` output (that's FIN-002's job, not this package's).

## 6. Likely affected components
- Refund-reference generation code path (locate via search for `RFD` prefix generation, likely near other `seq()`/`docSeq()` usage in `lib/store.tsx`)
- Repair-intake date field handling (repair intake form + its API route)
- New: `scripts/cleanup-data-001.mjs` (reviewed, one-time, backed-up cleanup script)
- New: `__tests__/data-validation.test.ts`

## 7. Implementation instructions
1. First, verify current state: query production (read-only) for any `ref` containing `NaN` and any repair/document date outside a sane range (e.g. before 2015 or more than 2 years in the future). Report actual current counts — the two originally-reported records may or may not still be present.
2. Locate the refund-reference generation logic; identify why it can produce `NaN` (likely a numeric parse of an undefined/non-numeric prior value) and add a guard: if the computed sequence number is not a finite positive integer, throw/reject rather than proceeding with a broken reference.
3. Add date-bounds validation to the repair-intake creation/update path (and any other path found producing an implausible date during step 1's investigation): reject dates before a configurable minimum (e.g. 2015-01-01) or after a configurable maximum (e.g. today + 2 years), returning a clear field-level error (coordinate with P1-DEED-004's field-validation pattern if that package has landed first — reuse it; otherwise a simple validation error is acceptable for this package alone).
4. Write `scripts/cleanup-data-001.mjs`: for any record still matching the known bad patterns, back up its current (bad) value into a small log table or JSON file, then apply the business-owner-confirmed correct value. Do not guess a correction — if the two records are still present, present them to the business owner for confirmation of the intended correct reference/date before applying.
5. Run the cleanup script only after backup and business-owner sign-off on the specific corrected values.

## 8. Acceptance criteria
- No newly created reference can contain `NaN`.
- No newly created repair (or other validated document) can carry a date outside the approved bounds.
- The two originally-reported bad records (if still present) are corrected, with their original values preserved in a recoverable log.
- Existing valid data is untouched.

## 9. Test plan
- **Unit:** reference-generation guard rejects a synthetic NaN-producing input; date-bounds validation rejects out-of-range dates.
- **Migration/cleanup test:** dry-run of the cleanup script against a staging copy; verify exact before/after values and that only the targeted records change.
- **Regression:** existing refund/repair creation flows unaffected for valid inputs.

## 10. Evidence required from the implementing agent
Current-state verification report (step 1); summary of changes; exact files; cleanup script + dry-run output; business-owner confirmation record for the corrected values; test commands + results; build result; risks; rollback (cleanup log allows exact reversal; validation code is a straightforward revert); unresolved issues.

## 11. Deployment plan
- **Branch:** `cursor/data-001-cleanup-ddc8`
- **Staging:** validation code deployed and tested first; cleanup script dry-run against a staging copy of the affected records (or a synthetic reproduction if the originals are gone) before any production run.
- **Migration order:** validation code ships before the cleanup script runs (prevents new bad data appearing while old data is being fixed).
- **Smoke test:** attempt to create a refund/repair with a deliberately bad input on staging; confirm rejection.
- **Human gate:** business-owner confirms the exact corrected values before the one-time cleanup script runs on production.
- **Rollback trigger:** cleanup script's dry-run output doesn't match expectations → do not run against production; re-investigate.
