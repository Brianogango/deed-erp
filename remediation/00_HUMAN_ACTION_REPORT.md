# Deed ERP — Action Report for the Business Owner

**Date:** 5 August 2026
**Prepared from:** Phase 1 audit (4 Aug), Backend Validation Addendum (5 Aug), Product Quality Audit (5 Aug), machine-readable findings, and a fresh inspection of the actual source code on 5 Aug 2026.

---

## 1. Overall position

> **Deed ERP is conditionally ready. It can continue being used, but several reliability, security, data-trust and usability improvements must be completed.**

**What is working well.** The scary conclusion from the first audit — "there is no real backend" — was wrong and has been formally withdrawn. Your system has a real database (PostgreSQL), a real server-side application layer, real login enforcement on every request, accounting journals that cannot be edited once posted, fiscal period locks, server-side document numbering, and automatic backups that have been successfully restored at least once. On top of that, since the audits were written, a large amount of remediation has **already been completed and deployed to production**: stronger passwords, instant lock-out of deactivated users, security headers, upload file-type verification, stock-level integrity fixes, server-side list pagination, automated end-to-end tests of your five most important workflows, staff user guides and an incident-response runbook.

**Can you keep using it?** Yes. Nothing found requires stopping operations. Day-to-day sales, repairs, purchasing and accounting can continue.

**The major risks that remain,** in plain language:

1. **A posted invoice can still be quietly altered through one legacy back door.** The modern route refuses changes, but the old "sync everything" route does not yet check whether an invoice is posted.
2. **All backups live on the same server as the live system.** If that one Contabo server dies or is compromised, you lose the system *and* every backup at once. The backups also contain your passwords in plain text.
3. **Anyone on the internet can try to guess the server's root password forever.** Remote root login with a password is enabled and there is no lock-out for repeated failed guesses. That password was also shared in plain text during the audit, so it must be treated as compromised.
4. **The activity log (audit trail) forgets.** Only the most recent 600 tamper-proof entries are kept; older ones silently disappear. And the older, visible audit log can still be written by the browser, which means it is not court-proof.
5. **The app can silently log people out and throw away a half-finished form.** A repair intake or a long quotation that takes several minutes can vanish with no warning and no way to recover it.

**What should happen first:** the five actions below, in the order listed. Items 1–3 are server/safety work with no visible change for staff. Items 4–5 change what users see, for the better.

---

## 2. The five most important actions

### Action 1 — Close the back door that lets posted invoices be edited
- **What is wrong:** the legacy data-sync route accepts changes to invoices without checking whether they are posted.
- **What it means for the business:** your invoice figures are not yet fully defensible to an auditor or KRA, because a knowledgeable insider could alter a posted invoice without a trace on that path.
- **What will be done:** the server will refuse any change to a posted invoice's amounts, dates, lines, customer or status through *every* route; corrections will only be possible via credit notes / reversals, and every refused attempt will be logged.
- **Who should handle it:** backend engineering (AI agent, with your sign-off on the correction workflow).
- **Will users notice?** Only if they were doing something they shouldn't — legitimate workflows are unchanged.
- **Downtime:** none.

### Action 2 — Get a copy of the backups off the server, and get secrets out of them
- **What is wrong:** every backup is stored on the same machine it protects, and each backup contains the master password file.
- **What it means for the business:** one hardware failure, ransomware event, or hosting-account problem loses everything, including the backups.
- **What will be done:** an encrypted copy of every backup will be sent automatically to separate storage; the password file will be excluded; a test restore will be performed and documented; you get an alert if a backup fails.
- **Who should handle it:** DevOps (AI agent + a small amount of your time to create the off-site storage account).
- **Will users notice?** No.
- **Downtime:** none.

### Action 3 — Lock down remote access to the server (SSH)
- **What is wrong:** direct root login with a password is allowed from anywhere; the root password has been shared in plain text; there is no protection against repeated guessing.
- **What it means for the business:** the whole ERP — data, money records, customer PII — is one guessed or leaked password away from total compromise.
- **What will be done:** rotate the root password immediately, switch to key-based login with a named administrator account, disable password login and direct root login, add automatic blocking of repeated failed attempts, and keep the Contabo web console as the emergency recovery route. Every step is tested before the old door is closed so you are never locked out.
- **Who should handle it:** DevOps, carefully sequenced. **This one should not be fully autonomous** — a human should be on the console during the final switch.
- **Will users notice?** No — this is server access, not the app.
- **Downtime:** none.

### Action 4 — Make the audit trail permanent and trustworthy
- **What is wrong:** the tamper-proof log keeps only the last 600 entries; the visible audit log can still be written by the browser.
- **What it means for the business:** in a dispute or fraud investigation, the record you would rely on may be incomplete or challengeable.
- **What will be done:** stop discarding old entries (archive them instead), make the server the only author of audit entries, and add search/export so old activity can be reviewed.
- **Who should handle it:** backend engineering.
- **Will users notice?** The audit screen may show more history; nothing else changes.
- **Downtime:** none.

### Action 5 — Stop silent logouts from destroying work
- **What is wrong:** when a login session expires, the app dumps the user to the login screen with no warning; anything typed into an open form is lost.
- **What it means for the business:** staff lose repair intakes and quotations mid-entry, re-type them, and sometimes data is entered twice or not at all.
- **What will be done:** the app will warn before a session expires, offer to extend it, save a draft of long forms automatically, return the user to the page they were on after logging back in, and offer to restore the draft.
- **Who should handle it:** frontend engineering.
- **Will users notice?** Yes — positively. This is the single most visible improvement for staff.
- **Downtime:** none.

---

## 3. Fix now

| Issue | Why it matters | Recommended action | Owner | Expected disruption |
|---|---|---|---|---|
| Posted invoices editable via legacy sync route (FIN-001) | Financial records not fully defensible | Server rejects all changes to posted invoices on every route; corrections via credit note only | Backend agent + owner sign-off | None |
| Backups on the same server, with passwords inside (SRV-003) | One failure loses system *and* backups | Encrypted off-site copies, secrets excluded, restore drill, failure alerts | DevOps agent + owner (storage account) | None |
| Root password SSH open to the world (SRV-001) | One password from total compromise | Rotate password, key-only login, disable root/password SSH, brute-force protection | DevOps + human on console | None |
| Audit log forgets after 600 entries; browser can write the legacy log (SEC-002) | Investigations and tax defence need complete history | Archive instead of discard; server-only authorship; search + export | Backend agent | None |
| Silent session loss destroys unsaved forms (DEED-001) | Staff lose long forms; data entered twice or never | Expiry warning, session refresh, draft autosave and restore, return-to-page | Frontend agent | None |

## 4. Fix next

- **Show the payment terms you are actually giving customers** (DEED-005). New contacts silently get 30-day credit terms. Requires your decision on the default (see §7).
- **Contact archive and merge** (DEED-006). 213+ contacts and growing, duplicates accumulating, no clean-up tool. Archive rather than delete; merges move all linked history.
- **Purchases filter counts** (DEED-007). The filter says "POs (0)" while 22 POs are on screen — it confuses document type with status. Split them.
- **Field-level validation messages** (DEED-004). Errors appear only as a toast; the form doesn't show *which* field is wrong.
- **Dark mode completion** (DEED-008). Status pills are unreadable in dark mode (measured contrast 1.86:1 vs required 4.5:1).
- **Product name truncation** (DEED-010). Up to 80% of a product name hidden in tables; two different laptops can look identical — mis-pick and mis-quote risk.
- **Invoice bulk-action bar** (DEED-011/012). "Pay 0 invoices" shown on an enabled button; duplicated counts and Clear buttons.
- **Keyboard focus visibility and screen-reader announcements** (DEED-002/003). Groundwork already exists in the code; verify on production and close the remaining gaps.
- **Finish the storage migration** (ARCH-001). The system still runs partly on the old "blob" storage. The measuring tools are now in place; migrate module by module (purchase orders, serials, stock moves next).
- **Stale-write protection** (SEC-005). Two people editing at the same time can silently overwrite each other on some screens.

## 5. Plan later

- Design-system consolidation (73 different button styles, 27 font sizes → one approved set) — do this after the defects above, not alongside.
- Dashboard "Trends" card layout at laptop widths (DEED-009), touch-target sizing, date/number format standardisation, route-name clean-up (`/after-sales` → redirect), "More" menu consistency.
- Reconciling dashboard vs module counts, with tooltips explaining each figure's definition.
- Follow-up audits for the seven untested roles, real mobile widths (360/390/768px), screen-reader (NVDA/VoiceOver) sessions, CSV import, exports, POS checkout completion, and the customer/supplier portals.
- Run the ERP under a dedicated service account instead of root; investigate PM2 restart churn; add uptime/memory/disk monitoring (SRV-002/005). Remove the stale firewall rule for port 3001 (SRV-004).

## 6. What is already good

Protect and keep these:

- The global command palette (Ctrl+K) — better than many commercial ERPs.
- The repair intake flow (phone-first lookup, accessories checklist, workflow-path choice) and the 18-state repair lifecycle.
- Well-crafted empty states; fast search, filtering and sorting everywhere.
- The existing domain APIs, server-side login enforcement, journal immutability and fiscal locks.
- The backup schedule and staging environment (they work — they just need an off-site copy).
- Everything shipped since the audit: password hardening, session revocation, security headers, upload validation, stock-level fixes, pagination, E2E test suite, user guides and incident runbook.

## 7. Decisions required from management

| # | Decision | Why you (not engineering) must decide |
|---|---|---|
| 1 | **Default payment terms** for new contacts: cash/due-immediately, or 30 days? And should existing contacts that silently received 30 days be reviewed? | It changes when invoices show as overdue and who gets credit. |
| 2 | **Contact merge policy:** who may merge, and is a merge reversible for how long? | Merges move sales/repair history between customer records. |
| 3 | **Document-numbering convention:** keep `INV/2026/0044` style, retire `INV-00065` style — one format for all new documents? | KRA/reconciliation implications; renumbering old documents is not proposed. |
| 4 | **Session timeout:** how long should a login last (currently 12 hours), and how long should the pre-expiry warning be? | Balance of security vs convenience for your staff. |
| 5 | **Audit retention:** how many years of activity history must be kept searchable? | Tax and legal defensibility requirement, storage cost. |
| 6 | **Maintenance window** acceptable for the SSH hardening final switch and future database migrations (target: none, but a fallback window helps). | Operational planning. |
| 7 | **Off-site backup destination:** which provider/account should hold encrypted backups (e.g. object storage bucket)? Engineering can recommend; you own the account. | Ownership and billing of your disaster-recovery copy. |

## 8. Progress tracker

| Area | Status |
|---|---|
| Password & session hardening (SEC-001 group) | **Completed** (deployed) |
| Security headers, CORS, portal phone verification | **Completed** (deployed) |
| Upload file-type validation | **Completed** (deployed) |
| Stock-level integrity + database indexes | **Completed** (deployed) |
| Server-side pagination of heavy lists | **Completed** (deployed) |
| E2E tests of critical workflows | **Completed** (deployed) |
| User guides + incident-response runbook | **Completed** (deployed) |
| Blob→domain parity measuring tools | **Completed** (deployed) |
| Posted-invoice immutability (FIN-001) | Not started |
| Off-site backups (SRV-003) | Not started |
| SSH hardening (SRV-001) | Not started — needs human on console |
| Audit retention + server-only audit (SEC-002) | Not started |
| Session stability + autosave (DEED-001) | Not started |
| Payment terms disclosure (DEED-005) | **Blocked** — awaiting decision #1 |
| Contact archive/merge (DEED-006) | Not started |
| Purchases filters (DEED-007) | Not started |
| Field validation binding (DEED-004) | Not started |
| Dark mode completion (DEED-008) | Not started |
| Product-name truncation (DEED-010) | Not started |
| Invoice bulk actions (DEED-011/012) | Not started |
| Focus indicators / announcements verification (DEED-002/003) | In progress (code groundwork exists; production verification pending) |
| Blob→domain module cutovers (ARCH-001) | In progress |
| Concurrency protection (SEC-005) | Not started |
| Design-system consolidation (DEED-037) | Deferred (planned) |
| Role/mobile/AT coverage audits (Workstream I) | Not started |
