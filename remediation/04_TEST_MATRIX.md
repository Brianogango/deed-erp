# Deed ERP — Test Matrix

Only relevant test types are listed per row. "Automatable" reflects whether the check can run in CI without a human.

| Module | Scenario | Preconditions | Test steps | Expected result | Priority | Type | Automatable |
|---|---|---|---|---|---|---|---|
| Finance | Edit posted invoice rejected (store path) | Invoice posted | `POST /api/store` with tampered `deed_invoices` | 409/merge-reject; stored invoice unchanged; audit event | P0 | Integration/Security | Yes |
| Finance | Edit posted invoice rejected (id route) | Invoice posted | `PATCH /api/invoices/[id]` changes total | 409; audit event | P0 | Integration/Security | Yes |
| Finance | Correction via credit note/reversal only | Posted invoice needs change | Create credit note | Original immutable; correction audited | P0 | Integration | Yes |
| Finance | Payment registration still works | Posted invoice | Register payment | `amountPaid` updates; invoice otherwise unchanged | P0 | Regression | Yes |
| Audit | Immutable timeline archive | Timeline near 600-row cap | Trigger append past cap | Displaced rows appear in archive, not discarded | P0 | Integration | Yes |
| Audit | Client cannot author `deed_auditLogs` | Any role with `appendAuditLog` | Submit crafted actor/timestamp | Server value used; client value ignored | P0 | Security | Yes |
| Audit | End users cannot edit/delete audit rows | Any role | Attempt update/delete via API | Rejected | P0 | Security | Yes |
| Session | Expiry warning shown | Session near expiry | Wait/force near-expiry | Warning modal with Extend appears | P0 | E2E | Yes |
| Session | Extend works without data loss | Warning shown, form open | Click Extend | Session refreshed; form state intact | P0 | E2E | Yes |
| Session | Return-to-route after re-login | Session expired mid-task | Re-authenticate | Lands on original route (or valid parent) | P0 | E2E | Yes |
| Session | Draft recoverable | Repair intake/quotation/journal in progress, interrupted | Reopen form after interruption | Restore prompt appears; data recoverable | P0 | E2E | Yes |
| Session | Draft excludes secrets | Draft saved | Inspect draft payload | No password/token/secret fields present | P0 | Unit | Yes |
| Session | Logout purges business data (SEC-004) | Logged in with data loaded | Explicit logout | No `deed_*`/`draft_*` keys remain in localStorage | P0 | E2E/Security | Yes |
| Infra | SSH root+password refused | SRV-001 applied | `ssh root@host` with password | Refused | P0 | Manual | No |
| Infra | Key login works for service admin | SRV-001 applied | `ssh deedops@host` with key | Succeeds; sudo works | P0 | Manual | No |
| Infra | Brute-force protection active | fail2ban installed | Simulated failed-login burst | IP banned | P0 | Manual | No |
| Infra | Off-site backup restorable | SRV-003 applied | Pull off-site copy, decrypt, restore to staging | Data matches source; row counts reconcile | P0 | Manual (restore drill) | No |
| Infra | No secrets in backup artifact | SRV-003 applied | Inspect artifact for `.env`/password strings | None found | P0 | Manual (secret scan) | No |
| Infra | Backup failure alert fires | SRV-003 applied | Force a backup step to fail | Alert received | P0 | Manual | No |
| Numbering | Concurrent creates unique | Two sessions | Create same-kind documents simultaneously | No duplicate/NaN refs | P1 | Concurrency | Yes |
| Numbering | Legacy counters no longer used | FIN-002 applied | Create DON/BBK/PAY/KO/KD/KS/EXP docs | Server-issued refs; no `deed_seq2_*` growth | P1 | Integration | Yes |
| Data integrity | No NaN references | DATA-001 applied | Attempt to create ref under NaN-triggering condition | Rejected | P1 | Unit | Yes |
| Data integrity | Date bounds enforced | DATA-001 applied | Enter repair date outside bounds | Rejected with field error | P1 | Unit | Yes |
| Concurrency | Stale write rejected | Two sessions, same non-merge-protected key | Both edit and save | Second save gets conflict message; no silent overwrite | P1 | Concurrency | Yes |
| Concurrency | Merge-protected keys still merge | Two sessions, different records in journals/products/repairs | Both edit and save | Both changes preserved | P1 | Regression | Yes |
| Concurrency | No duplicate `/store` requests | Any route | Load route, count network requests | At most one `/store` GET per key per load | P1 | E2E | Yes |
| Accessibility | Field validation bound | Any of the 4 target forms | Submit invalid | Inline error, `aria-invalid`, `aria-describedby`, focus moved, data preserved | P1 | Accessibility/E2E | Yes |
| Accessibility | Focus indicators visible | Any of 24 routes | Tab through | Visible ring in light and dark mode | P1 | Accessibility | Partial |
| Accessibility | Live-region announcements | Async/success/error states | Trigger each state | Announced once; error has `role="alert"` | P1 | Accessibility | Partial |
| Contacts | Purchases filter counts match rows | 22 POs present | Select Type=PO | Count shows 22; rows match | P1 | E2E | Yes |
| Contacts | Contact archive hides from pickers | Contact archived | Open any contact picker | Archived contact absent; still visible in history | P1 | E2E | Yes |
| Contacts | Merge relinks all related records | Two contacts with sales/invoices/repairs | Merge | All records relinked to survivor; none orphaned | P1 | Integration | Yes |
| Contacts | Merge reversible within window | Merge completed, within window | Reverse | Exact prior state restored | P1 | Integration | Yes |
| Contacts | Delete blocked with transactions | Contact has invoices | Attempt delete | Blocked (API and UI) | P1 | Permission | Yes |
| Finance | Bulk-pay disabled at zero payable | Selected invoices all draft | Observe bar | Pay disabled; reason shown | P1 | E2E | Yes |
| Finance | Bulk selection summary not duplicated | Any selection | Observe bar | One count, one Clear | P1 | Visual/E2E | Yes |
| UI | Dark-mode contrast | Dark mode enabled | Measure status pills/tabs/links | ≥4.5:1 | P1 | Accessibility | Partial |
| UI | Product name not misleadingly truncated | 6 named modules | View long product names | ≤30% hidden without tooltip; tooltip discloses full name | P1 | Visual/Measurement | Partial |
| Data cutover | Parity check clean | ARCH-001 slice complete | Run `pnpm parity:check` | Zero hard-stop gaps for certified module | P1 | Integration | Yes |
| Data cutover | Financial totals reconcile | Backfill complete | Compare pre/post totals | Match | P1 | Reconciliation | Yes |
| Infra | Non-root process | SRV-002 applied | `pm2 list` | User is not root | P2 | Manual | No |
| Infra | Monitoring alerts fire | Monitoring installed | Induce each failure condition | Alert received | P2 | Manual | No |
| Counts | Displayed counts match DB query | DEED-035 findings applied | Compare each labelled count | Match documented definition | P2 | Reconciliation | Yes |
| Approvals | Threshold enforced server-side | FUNC-001 applied | Attempt over-threshold action without approval | Blocked until distinct approver approves | P2 | Workflow/Security | Yes |

## Release quality gates
- All P0 tests green before any P0 item is marked complete.
- All P1 tests for included work green before that sprint closes.
- No new critical accessibility violation introduced by any change (axe baseline comparison).
- No posted financial record becomes less protected by any change (regression-tested against P0-FIN-001's guard).
- No audit history is lost (row-count reconciliation before/after every audit-adjacent change).
- No backup or restore capability is weakened (restore drill re-run after any backup-script change).
