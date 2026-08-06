# Deed ERP — Decisions Required From Management

These seven decisions genuinely require the business owner, not engineering. Nothing below should be decided by an AI agent or an engineer on the owner's behalf.

## Decision 1 — Default payment terms
**Question:** Should a new contact default to cash/due-immediately, or 30-day credit terms? Should previously-created contacts that silently received 30-day terms be reviewed and potentially corrected?
**Why it needs you:** It changes when a customer's invoice is marked overdue, affects AR ageing reports, and determines who is implicitly extended credit without a conversation.
**Blocks:** P1-DEED-005 (full closure — the UI-visibility fix can ship without this decision, but the actual default value cannot change until you decide).
**Recommendation from the audit teams:** No default recommendation given — this is a business policy call specific to how Deed Technologies wants to treat walk-in vs. account customers.

## Decision 2 — Contact merge policy
**Question:** Who is allowed to merge duplicate contacts (Director only, or also Admin Officer/Sales)? For how long after a merge should it remain reversible?
**Why it needs you:** A merge moves sales, invoice, and repair history between customer records — an operational/trust decision, not a technical one.
**Blocks:** P1-DEED-006's permission gating (the archive/merge feature itself can be built with a safe Director-only default while this decision is pending).
**Recommendation:** Consider Director + Admin Officer with a 30-day reversibility window as a reasonable starting point, but this is your call.

## Decision 3 — Document-numbering convention
**Question:** Should all new documents standardise on one numbering format (e.g. `INV/2026/0044`), retiring the older `INV-00065` style for anything newly created?
**Why it needs you:** Has KRA/tax-reconciliation implications and affects how your team reads and files documents day to day. No existing document would be renumbered — this only affects the format used going forward.
**Blocks:** FIN-002b (P3, deliberately deferred — not urgent, but should be decided before that work is scheduled).

## Decision 4 — Session timeout policy
**Question:** How long should a login session last (currently 12 hours), and how many minutes of warning should a user get before it expires?
**Why it needs you:** A balance between security (shorter sessions reduce risk if a device is left unlocked) and convenience for staff who may work in long stretches without re-authenticating.
**Blocks:** P0-DEED-001's final tuning (the mechanism can be built with the current 12-hour default and a sensible warning lead time, e.g. 5 minutes, and adjusted later if you decide differently).
**Recommendation from the Product Quality Audit's context:** the existing 12-hour session is reasonable for a business application; the missing piece is the warning and draft-recovery, not necessarily the duration itself.

## Decision 5 — Audit retention duration
**Question:** How many years of activity history must remain searchable for tax, legal, or dispute purposes?
**Why it needs you:** This is a compliance and record-keeping requirement specific to your business and jurisdiction (Kenya), not a technical default.
**Blocks:** P0-SEC-002's archive design (the archive mechanism itself is retention-duration-agnostic and can be built now; the actual retention period/policy is your decision).

## Decision 6 — Acceptable maintenance window
**Question:** Is there a preferred time window (e.g. late night, weekend) for infrastructure changes like the SSH hardening switch, even though no downtime is expected?
**Why it needs you:** As a safety margin — while the plan is designed for zero downtime, having a quiet window for the SSH final-switch step reduces risk if something needs a moment to resolve.
**Blocks:** Scheduling of P0-SRV-001 (can proceed without a formal window if you're comfortable, but a window is recommended for this specific step).

## Decision 7 — Off-site backup destination
**Question:** Which off-site storage provider/account should hold the encrypted backup copies (e.g. a cloud object-storage bucket)?
**Why it needs you:** You own the account, its cost, and its access — engineering can recommend an approach (e.g. a low-cost object storage bucket) but should not create or pay for it on your behalf without your knowledge.
**Blocks:** P0-SRV-003 (the script changes to prepare for off-site backup can be written now; the actual destination credentials require your account).

---

**None of the above decisions block the security-hardening or bug-fixing work that doesn't touch these specific areas.** Sprint 1's session-refresh mechanism, focus indicators, live regions, field validation, purchases filters, dark mode, and product-name truncation can all proceed without waiting for any of these seven decisions.
