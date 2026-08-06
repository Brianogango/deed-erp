# P0-SEC-002 — Audit log retention and server-only authorship

## 1. Task identity
- **Task ID:** P0-SEC-002 · **Priority:** P0 · **Severity:** High
- **Assigned agent type:** Backend Agent + Security review
- **Related findings:** SEC-002 (Phase 1 + Addendum residual)
- **Business owner:** Director (sets retention duration — Decision 5) · **Technical reviewer:** Security

## 2. Plain-language objective
The activity log that finance and management rely on to investigate disputes or fraud never quietly forgets old entries, and nobody can write into it from their browser and have it accepted as if the server had written it.

## 3. Confirmed problem
- **Evidence (verified 5 Aug 2026, master@38b75aa):**
  - `app/api/store/route.ts:24`: `const MAX_AUDIT_ROWS = 600` — the server-generated, client-immutable timeline (`deed_audit_timeline_v1`, `IMMUTABLE_AUDIT_KEY`) is sliced to the last 600 rows on every append (`.slice(-MAX_AUDIT_ROWS)` at line ~63). Older rows are permanently discarded, not archived.
  - `lib/auth/authorization.ts:81,137`: the legacy `deed_auditLogs` key still maps to the `appendAuditLog` permission, held by seven roles (`director, admin_officer, finance_officer, sales_rep, inventory_officer, technical_lead, kilimall_officer`) — meaning the browser can still write whatever content it wants into that array and the server will store it as-is (subject only to the generic anti-wipe protection, not content validation).
  - Separately, a genuine server-authored `audit_logs` Prisma table exists (259 rows at Addendum time) and is populated by domain-API write paths — this table is fine and must not be touched.
- **Reproduction:** (a) inspect `MAX_AUDIT_ROWS` and the slice call; (b) as a role holding `appendAuditLog`, POST a crafted `deed_auditLogs` array with a fabricated entry — it is accepted.
- **Expected:** no audit entry is discarded before the approved retention period; the client cannot inject arbitrary rows into any audit-representing key.
- **Root cause:** the 600-row cap was a pragmatic size limit for a live-streamed key, and `deed_auditLogs` predates the server-side timeline and was never locked down once the newer mechanism arrived.
- **Confidence:** High (direct code inspection).

## 4. Scope
- Replace the rolling `.slice(-600)` discard with an archive: rows displaced from the live timeline are written to a persistent store (a new Prisma table, e.g. `AuditArchive`, or reuse the existing `audit_logs` table if schema-compatible) instead of being dropped.
- Make `deed_auditLogs` server-authored: either (a) the server ignores/overwrites client-supplied `actor`/`timestamp`/content on this key and derives entries only from actual server-observed actions, or (b) the key becomes read-only to clients (dropped on write, like `deed_audit_timeline_v1` already is) and the UI is pointed at the immutable timeline plus the new archive instead. Prefer (b) — it reuses an already-correct pattern.
- Add search + export for the combined live-timeline + archive view, scoped to the Director role.
- Preserve every existing historical row exactly as-is during the migration.

## 5. Out of scope
- The domain-API `audit_logs` Prisma table and its write paths (already correct — do not touch).
- UI redesign of the audit screen beyond adding search/export.
- Retention policy for non-audit data.
- FIN-001 (separate package, though both touch `app/api/store/route.ts` — coordinate to avoid merge conflicts; land FIN-001 first, then rebase this package).

## 6. Likely affected components
- `app/api/store/route.ts` (MAX_AUDIT_ROWS logic, `appendStoreAudit`, `CLIENT_IMMUTABLE_STORE_KEYS` handling for `deed_auditLogs`)
- `lib/auth/authorization.ts` (retire or repurpose the `appendAuditLog` permission mapping for `deed_auditLogs`)
- `prisma/schema.prisma` (new archive table, additive migration)
- Audit-viewing UI component (locate via `deed_auditLogs` / `deed_audit_timeline_v1` consumers)
- New: `lib/audit-archive.ts` (archive read/write helpers)
- Tests: new `__tests__/audit-retention.test.ts`, extend any existing audit tests

## 7. Implementation instructions
1. Locate every place `deed_auditLogs` is read or written client-side and server-side (search `deed_auditLogs` across `lib/store.tsx` and `app/api/store/route.ts`).
2. Add `deed_auditLogs` to the same client-immutable handling as `deed_audit_timeline_v1` in the store route: client-submitted values for this key are dropped/ignored on write (log the attempt, do not error the whole request). Do not delete the existing array's historical content — treat this exactly like the existing immutable-key pattern already proven for the timeline.
3. Add a Prisma migration for an archive table (e.g. `AuditArchive { id, ts, actor, action, entity, entityId, detail Json, createdAt }`) mirroring the timeline entry shape. Migration must be additive only — no destructive changes, and include down-migration notes even though Prisma migrations are typically forward-only (document the manual rollback: drop the new table, no data loss since it's additive).
4. In the timeline-append function (`appendStoreAudit` / wherever `.slice(-MAX_AUDIT_ROWS)` happens), before slicing, write the rows that are about to be dropped into the archive table (not raise the cap arbitrarily — the live key must stay small for SSE/sync performance; the archive is the long-term store).
5. Build a combined read path (e.g. `GET /api/admin/audit?from=&to=&q=`) that queries live timeline + archive together, paginated, Director-only, supporting a text search over actor/action/entity and a CSV export.
6. Confirm no existing historical row is lost: before deploying, snapshot current `deed_audit_timeline_v1` and `deed_auditLogs` counts; after deploying, confirm `live + archive >= pre-deploy count`.
7. Add tests per §9.

## 8. Acceptance criteria
- No audit entry is ever discarded before the business-owner-approved retention period (Decision 5); rows displaced from the live timeline land in the archive, not the void.
- Client-supplied content, actor, or timestamp for `deed_auditLogs` and `deed_audit_timeline_v1` are ignored on write; the server is the sole author of both.
- End users cannot update or delete any audit row through any API (server rejects with 403/409 as appropriate).
- Director can search and export the combined audit history.
- All rows present before this change are present after it (spot-checked count + sample content match).

## 9. Test plan
- **Unit:** archive-on-slice logic; client-write rejection for `deed_auditLogs`.
- **Integration:** tamper attempt (crafted actor/timestamp) → server value used instead; displaced-row archival round-trip.
- **Migration test:** apply migration to a copy of the staging DB; verify existing rows untouched; verify rollback (drop new table) leaves original tables intact.
- **Regression:** existing audit-dependent tests (if any) still pass.
- **Manual UAT:** Director searches/export the audit view; confirms history beyond 600 entries is visible.

## 10. Evidence required from the implementing agent
Summary of changes; exact files; migration SQL; before/after row counts; test commands + results; build result; screenshots of search/export; risks; rollback steps (migration down + code revert); unresolved issues.

## 11. Deployment plan
- **Branch:** `cursor/sec-002-audit-retention-ddc8`
- **Staging:** apply migration to `deed_erp_staging` first; run reconciliation counts; verify search/export.
- **Migration order:** additive table creation only; no data migration risk to existing tables.
- **Smoke test:** trigger enough store-sync activity to force a timeline slice; confirm displaced rows appear in archive.
- **Human gate:** business owner confirms the retention duration and who may access search/export before production.
- **Production:** standard deploy + `prisma migrate deploy`; monitor archive table growth for the first week.
- **Rollback trigger:** archive write failures blocking normal store-sync operation → revert code (migration stays, additive and harmless).
