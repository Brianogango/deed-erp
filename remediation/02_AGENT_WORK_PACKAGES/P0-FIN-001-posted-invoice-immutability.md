# P0-FIN-001 — Posted-invoice immutability on every write path

## 1. Task identity
- **Task ID:** P0-FIN-001
- **Title:** Reject all mutations to posted invoices on the legacy store path; corrections only via credit note / reversal / cancel
- **Priority:** P0 · **Severity:** Critical
- **Assigned agent type:** Backend Agent
- **Related findings:** FIN-001 (Phase 1 + Addendum residual); supports SEC-002
- **Business owner:** Deed Technologies director (sign-off on correction workflows)
- **Technical reviewer:** Security review required (financial-control change)

## 2. Plain-language objective
Once an invoice is posted, nothing and nobody can quietly change its numbers, dates, lines or customer — on any route into the system. Corrections happen only through visible, auditable credit notes, reversals or cancellations.

## 3. Confirmed problem
- **Evidence (verified 5 Aug 2026, master@38b75aa):**
  - `app/api/store/route.ts` protects journals (`mergeAppendOnlyJournals` → 409 on edits), blocks empty-array wipes, and protects invoice lines against empty-shell overwrites (`preserveInvoiceLinesOnStoreWrite`, ~lines 236–247) — but has **no posted-status guard**: a role holding the `deed_invoices` write permission can change a posted invoice's `total`, `lines`, `date`, `partnerId`, `taxTotal`, `status`, etc.
  - `app/api/store/[key]/route.ts` has the same gap (only line preservation, ~line 62).
  - `app/api/invoices/[id]/route.ts` protects only the invoice **number** after posting; other fields on a posted invoice are accepted.
- **Reproduction:** authenticated session with finance write permission → `POST /api/store` with `deed_invoices` array where one posted invoice's total is changed → 200, change persists.
- **Expected behaviour:** rejection; stored invoice unchanged; audit event.
- **Actual behaviour:** silent acceptance.
- **Root cause:** store-path protections were built incrementally (wipes, lines, journals); posted-header immutability was never added.
- **Confidence:** High (direct code inspection).

## 4. Scope
- `lib/finance-invoice.ts`: add `enforcePostedInvoiceImmutability(current, incoming)` merge guard (pure, unit-testable).
- Wire the guard into `app/api/store/route.ts` and `app/api/store/[key]/route.ts` for `deed_invoices`.
- Extend `app/api/invoices/[id]/route.ts` PATCH/PUT: reject changes to protected fields when stored status ∈ {posted, approved, paid} (use the existing legacy-status map at the top of that file).
- Server audit event for every rejected attempt and every accepted correction-workflow write.
- Regression tests.

## 5. Out of scope
- Draft-invoice editing (unchanged).
- The credit-note / reversal / cancel workflows themselves (regression only — they must keep working).
- UI changes; blob→domain cutover (ARCH-001); journal merge logic; fiscal locks.

## 6. Likely affected components (verified paths)
- `lib/finance-invoice.ts`
- `app/api/store/route.ts`
- `app/api/store/[key]/route.ts`
- `app/api/invoices/[id]/route.ts`
- `__tests__/finance-invoice.test.ts` (extend)
- New: `__tests__/posted-invoice-immutability.test.ts`

## 7. Implementation instructions
1. Protected field set for a posted invoice: `lines`, `subtotal`, `taxTotal`, `total`, `date`, `dueDate`, `partnerId`, `partnerName`, `currencyCode`, `exchangeRateToBase`, `type`, `ref`/`invoiceNumber`. Explicitly NOT protected: `amountPaid` (payments flow), `paymentBlocked`, `notes` (append-only annotation), and status transitions on the approved list.
2. Allowed status transitions from posted: → `paid` (payments path), → `cancelled` (soft-cancel per PR #217 conventions). Any other status change on a posted invoice → reject.
3. Implement `enforcePostedInvoiceImmutability(currentArr, incomingArr)`: for each incoming invoice whose stored counterpart is posted/approved/paid, compare protected fields; if any differ, restore stored values (merge-reject) and add the invoice id/ref + attempted fields to a returned `rejected` list. Return `{ merged, rejected }`.
4. Store routes: apply the guard after JSON parse, before `saveStoreKeys`. If `rejected.length > 0`, save the merged (protected) value, respond 200 with `{ rejectedPostedEdits: [...] }`, **and** write an audit event naming the server-session actor, invoice refs, and attempted fields. Rationale (document in code): the store path syncs whole arrays — failing the entire write would block unrelated changes; merge-reject preserves integrity without data loss.
5. `app/api/invoices/[id]/route.ts`: hard-reject with 409 + audit (single-document path).
6. Audit events: reuse the immutable timeline append with distinct kinds `posted_invoice_edit_rejected` / `posted_invoice_correction`.
7. Add tests; do not modify existing passing tests except to extend.

## 8. Acceptance criteria
- Given a posted invoice, when a write via `/api/store`, `/api/store/deed_invoices`, or `PATCH /api/invoices/[id]` attempts to change any protected field, the stored invoice remains unchanged and the response identifies the rejection.
- The rejected attempt creates an immutable server-side audit event with the actor taken from the server session.
- Credit note, reversal, cancellation and payment-registration workflows still succeed (regression suite green).
- Draft invoices remain fully editable.

## 9. Test plan
- **Unit:** guard — posted header change rejected; draft passes; `amountPaid` change passes; posted→cancelled passes; posted→draft rejected.
- **Integration:** store round-trip with tampered posted invoice → stored value unchanged + audit row; `[id]` route → 409.
- **E2E:** existing finance smoke + credit-note flow.
- **Concurrency:** two sessions writing invoice arrays; guard applies to both.
- **Manual UAT:** finance officer edits a draft (works); attempts posted edit (server rejects).

## 10. Evidence required from the implementing agent
Summary of changes; exact files; test commands + results; build result; before/after API transcripts of the tamper attempt; risks; rollback (single revert); unresolved issues.

## 11. Deployment plan
- **Branch:** `cursor/fin-001-posted-invoice-immutability-ddc8`
- **Staging:** deploy branch, run tamper script against staging DB copy.
- **Migrations/env:** none.
- **Smoke:** create draft → post → attempt edit → rejected → register payment → paid.
- **Human gate:** business-owner confirms the allowed-corrections list before production.
- **Production:** standard `deed-erp-deploy.sh`; monitor `posted_invoice_edit_rejected` audit events for 48 h (false-positive watch).
- **Rollback trigger:** any legitimate workflow blocked (payments/credit notes) → revert commit, redeploy.
