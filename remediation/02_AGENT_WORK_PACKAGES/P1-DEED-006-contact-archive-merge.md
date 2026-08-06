# P1-DEED-006 — Contact archive, restore, and merge

## 1. Task identity
- **Task ID:** P1-DEED-006 · **Priority:** P1 · **Severity:** High
- **Assigned agent type:** Full-stack Agent
- **Related findings:** DEED-006 (Product Quality Audit)
- **Business owner:** **Requires Decision 2** (who may merge; reversibility window) — implementation can start on schema/API; final permission gating awaits the decision
- **Technical reviewer:** Tech lead + Security (data-relinking correctness)

## 2. Plain-language objective
Duplicate or obsolete customer/vendor records can be tidied up safely: an unwanted contact can be archived (hidden, not destroyed) and two duplicate contacts can be merged into one, with all their sales, invoices, and repair history correctly following the surviving record — and every merge is logged and reviewable.

## 3. Confirmed problem
- **Evidence:** no `archiveContact` or `mergeContact` function exists anywhere in the repository (confirmed via repo-wide search); the Product Quality Audit notes 213+ contacts with no removal/cleanup path and flags a test contact created during the audit that is now permanently stuck in production data as a direct illustration of the gap.
- **Reproduction:** attempt to remove or consolidate a duplicate contact in the Contacts module — no such action exists.
- **Expected:** archive/restore lifecycle; a guided merge that previews the effect, relinks related records, and is reversible for a defined window.
- **Root cause:** the feature was never built.
- **Confidence:** High.

## 4. Scope
- Add an `isArchived` (or equivalent) flag to the contact model with archive/restore API + UI actions.
- Block hard deletion of any contact with linked transactions (sales, invoices, repairs) — archive is the only path for those; a contact with zero linked transactions may still only be archived, not hard-deleted, consistent with the ERP's existing "no hard delete of business records" posture (per Settings' existing "Disable Product Deletion" philosophy noted as a strength in the audit).
- Build a merge wizard: select a duplicate pair, choose the surviving record, preview every related record that will be relinked (sales orders, invoices, repairs, notes, history, quotes), confirm, execute.
- Merge writes a server-side audit entry (using the existing audit mechanism, coordinated with P0-SEC-002's server-authorship fix landing first or in parallel) and a merge-log record enabling reversal within the owner-approved window (Decision 2).

## 5. Out of scope
- Hard-deleting any contact under any circumstance in this package.
- Merging any entity type other than contacts (no product/repair merge tooling).
- Automatic/bulk merging (every merge is a deliberate, previewed, single-pair action by an authorized user).

## 6. Likely affected components
- `prisma/schema.prisma` (contact model — add `isArchived`, and a new `ContactMergeLog` model)
- Contacts module UI (`components/modules/Contacts.tsx` and its detail/list components)
- Contact-related API routes (`app/api/contacts/` — confirm exact structure)
- Every entity with a contact foreign key that must be relinked on merge: sales orders, invoices, repairs, quotes, notes/history — enumerate exact tables via `prisma/schema.prisma` search for the contact relation before writing the relink logic, so nothing is missed
- New: `app/api/contacts/[id]/archive/route.ts`, `app/api/contacts/merge/route.ts`
- New: `__tests__/contact-archive-merge.test.ts`

## 7. Implementation instructions
1. Add `isArchived Boolean @default(false)` (or equivalent) to the contact model via an additive Prisma migration; add matching `archivedAt`/`archivedBy` fields for auditability.
2. Add archive/restore API endpoints and UI actions (a button on the contact detail view, with confirmation). Archived contacts are excluded from default pickers/dropdowns app-wide but remain fully visible in historical documents and searchable via an explicit "show archived" toggle.
3. Enumerate every model with a foreign key to Contact (grep `prisma/schema.prisma` for the relation) — this list must be complete before building the merge relink logic, since a missed relation means orphaned/stale references after a merge.
4. Build the merge API: given `survivorId` and `mergedId`, within a single database transaction: (a) reassign every enumerated foreign-key reference from `mergedId` to `survivorId`, (b) mark `mergedId`'s contact record as archived with a `mergedIntoId` pointer (do not delete it — this enables reversal and preserves referential history), (c) write a `ContactMergeLog` row capturing exactly which records were relinked (id + table) so a reversal can be computed, (d) write a server-side audit entry.
5. Build the merge UI: a picker for the two contacts, a preview screen listing every record that will move (grouped by type, with counts), and a final confirm step. Do not allow the merge to proceed without the user viewing the preview.
6. Implement reversal (within the owner-approved window from Decision 2): given a `ContactMergeLog` row, reverse the relink for every recorded record, unarchive the merged contact, and audit the reversal. If the window has passed, disable the reversal action in the UI (server still enforces it).
7. Enforce permission gating for who may initiate a merge per Decision 2 once received; until then, gate to Director role as a safe default.

## 8. Acceptance criteria
- Archived contacts are hidden from pickers but retain full history and remain visible when explicitly viewing archived records.
- A merge relinks every related sales/invoice/repair/note/history record to the surviving contact; nothing is orphaned.
- The merge preview accurately reflects what will change before the user confirms.
- The merge is recorded in the server audit log.
- The merge is reversible within the approved window; reversal restores the exact prior state.
- Deletion of a contact with linked transactions is blocked everywhere (API and UI).

## 9. Test plan
- **Unit:** relink logic for each related entity type.
- **Integration:** full merge transaction — create two contacts each with a sale/invoice/repair, merge, verify all relinked correctly; then reverse and verify exact restoration.
- **Permission tests:** merge action gated to the approved role(s).
- **Migration test:** schema migration applies cleanly to a staging copy with existing data; archived flag defaults correctly for all existing rows (all `false`).
- **Manual UAT:** merge two real-looking duplicate test contacts on staging; verify their invoice/repair history correctly appears under the survivor.

## 10. Evidence required from the implementing agent
Summary of changes; exact files; migration SQL; before/after screenshots of the merge preview and confirmation; test commands + results; build result; complete list of relinked entity types (proving the enumeration in step 3 was thorough); risks; rollback (migration is additive; merge itself is reversible via the log; a hard rollback of the feature is a code revert with the archived flag left in schema, harmless if unused); unresolved issues.

## 11. Deployment plan
- **Branch:** `cursor/deed-006-contact-archive-merge-ddc8`
- **Staging:** apply migration; test archive/restore and a full merge+reversal cycle with realistic staging data.
- **Migration order:** schema migration first (additive, safe to deploy ahead of the feature code), then feature code.
- **Smoke test:** archive a test contact, confirm it's hidden from pickers; merge two test contacts, confirm relinking; reverse, confirm restoration.
- **Human gate:** Decision 2 (merge permission + reversibility window) required before production; Director-only gating acceptable as an interim default if the decision is pending but the business wants to ship the archive half sooner.
- **Rollback trigger:** any relink found incomplete/incorrect in staging → do not proceed to production until the enumeration in step 3 is corrected and re-tested.
