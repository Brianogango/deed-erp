# P1-DEED-005 — Disclose payment terms; stop silent 30-day credit assignment

## 1. Task identity
- **Task ID:** P1-DEED-005 · **Priority:** P1 · **Severity:** High
- **Assigned agent type:** Frontend Agent + Backend Agent (review script)
- **Related findings:** DEED-005 (Product Quality Audit)
- **Business owner:** **BLOCKED — requires Decision 1** (default payment terms; whether to review previously auto-assigned contacts) before implementation can be finalized
- **Technical reviewer:** Tech lead

## 2. Plain-language objective
When someone creates a new customer, the payment terms being applied are shown clearly on screen as an actual value, not hidden in a greyed-out hint — and a true cash customer can be marked as such instead of automatically getting 30 days of credit.

## 3. Confirmed problem
- **Evidence:** Product Quality Audit: "Every contact created through this form silently becomes a 30-day credit account." `paymentTermsDays?: number` is optional in the contact model (`lib/store.tsx:453`); the audit reports the value is shown only as a placeholder, not a real selected value, in the create-contact form.
- **Reproduction:** create a new contact without touching the payment-terms field; the resulting record carries `paymentTermsDays: 30` (or equivalent default) with no visible confirmation at save time.
- **Expected:** the actual default value is visibly selected/displayed (not merely a placeholder), and an explicit "Cash / due immediately" option exists and is easy to choose.
- **Root cause:** UI convenience default implemented as an input placeholder rather than a pre-selected, visible value.
- **Confidence:** High.

## 4. Scope
- Change the contact-creation/edit form so the payment-terms field shows a real, visibly-selected default value (not a placeholder ghost-text).
- Add an explicit "Cash / due immediately" (0 days) option, presented as a first-class choice, not an edge case.
- Add brief inline helper text explaining the effect on invoice due dates and AR ageing.
- Write a read-only review script (per Decision 1) that lists contacts which received the default via the old placeholder behavior, for the owner's review — **do not auto-migrate any contact's terms without an explicit owner decision on each cohort** (e.g., "these can all be reviewed and confirmed cash" vs "these should be confirmed 30-day").

## 5. Out of scope
- Changing the default terms VALUE itself (0 vs 30) — that is Decision 1, owned by the business.
- Any bulk automatic change to existing contacts' terms (the review script only reports; a human decides and a separate, explicitly approved follow-up applies any change).
- AR ageing calculation logic itself (unchanged; only the visibility of the input that feeds it changes).

## 6. Likely affected components
- Contact create/edit form component (`components/modules/Contacts.tsx` or its modal — confirm exact path)
- `lib/store.tsx` (`paymentTermsDays` field definition, ~line 453, and the Contact type/default-value logic)
- New: `scripts/review-default-payment-terms.mjs` (read-only reporting script)
- Tests: extend existing contact-creation tests if present, or add new

## 7. Implementation instructions
1. **Wait for Decision 1** before finalizing the default value change (the UI-visibility fix in step 2 can proceed independently since it doesn't depend on which default is chosen).
2. Locate the payment-terms input in the contact form; change it from a placeholder-only presentation to a real controlled value that is visibly pre-filled with the current default (whatever it is, pending Decision 1) — the user must see "30 days" (or "0 — Cash / due immediately") actually populating the field, not greyed placeholder text.
3. Add "Cash / due immediately" as an explicit, prominent option in whatever control type is used (dropdown/radio) — not buried as "0" in a numeric input with no label.
4. Add one line of helper text near the field: e.g., "This determines when this customer's invoices are marked overdue."
5. Write `scripts/review-default-payment-terms.mjs`: a read-only script that queries contacts, reports how many currently hold the previous silent default with no explicit confirmation timestamp/flag, and outputs a CSV/JSON list for owner review. This script must not modify any data.
6. Do not write or run any migration that changes existing contacts' terms in this package — that requires a separate, explicitly-approved follow-up once the owner reviews the report from step 5.

## 8. Acceptance criteria
- The payment-terms value shown at contact-creation time is a real, visible, selected value — never merely a placeholder.
- "Cash / due immediately" is selectable as a first-class, clearly labeled option.
- Helper text explains the due-date effect.
- No contact acquires a payment-terms value without that value being visibly displayed to the user at save time.
- A review report exists listing previously-silently-defaulted contacts, with no changes yet applied to their data.

## 9. Test plan
- **Unit:** form default-value rendering (real value vs placeholder) verified via component test.
- **E2E:** create a contact without touching the terms field; assert the saved record's terms match what was visibly displayed (not a hidden fallback).
- **Manual UAT:** owner reviews the report from step 5 and confirms the required cohort handling (feeds Decision 1's second half).

## 10. Evidence required from the implementing agent
Summary of changes; exact files; before/after screenshots of the form; the review-script output (counts only, no need to reproduce full PII list in the report); test commands + results; build result; risks; rollback (form-level revert); unresolved issues (explicitly note this package cannot fully close until Decision 1 is made).

## 11. Deployment plan
- **Branch:** `cursor/deed-005-payment-terms-ddc8`
- **Staging:** deploy the UI-visibility fix independent of the default-value decision; run the review script against a staging copy of the data first.
- **Migrations/env:** none for the UI fix; any data change is a separate, future, explicitly-approved package.
- **Smoke test:** create a contact, confirm the visible default and the cash option both work as expected.
- **Human gate:** business-owner Decision 1 required before this package is considered complete (the UI fix can ship ahead of the decision since it doesn't change behavior for existing contacts).
- **Rollback trigger:** none expected (additive, non-destructive) — standard revert if a regression is found.
