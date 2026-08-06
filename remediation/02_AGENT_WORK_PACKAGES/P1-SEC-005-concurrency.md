# P1-SEC-005 — Optimistic concurrency on /api/store writes

## 1. Task identity
- **Task ID:** P1-SEC-005 · **Priority:** P1 · **Severity:** Medium
- **Assigned agent type:** Backend Agent
- **Related findings:** SEC-005 (Phase 1 + Addendum, narrowed); bundles the duplicate `/store` request cleanup (PERF-DUP) since both touch the same sync surface
- **Business owner:** n/a · **Technical reviewer:** Tech lead

## 2. Plain-language objective
If two people edit the same screen's data at almost the same time, the second person is told clearly that someone else's changes would be overwritten, instead of one person's work silently disappearing.

## 3. Confirmed problem
- **Evidence (verified 5 Aug 2026):** `POST /api/store` in `app/api/store/route.ts` has no `If-Match`/version precondition check on the general write path; protection is limited to specific merge functions (`mergeAppendOnlyJournals`, product/repair/outsource id-based merges, content-filtered ledger per-row merges). Any `deed_*` key outside those targeted merges is last-writer-wins. `GET /api/store` does compute a weak ETag and supports 304, but the POST side never requires a matching ETag before accepting a write.
- **Reproduction:** two sessions load the same route, both hold stale copies of a non-merge-protected key, both write — the second write silently overwrites the first's changes with no error.
- **Expected:** the server rejects a write when the client's known version is stale, with a clear conflict message; the client can refetch and retry.
- **Root cause:** whole-blob sync model predates any per-record versioning; targeted merges were added reactively for high-value ledgers only.
- **Confidence:** High.

## 4. Scope
- Add a version/ETag precondition check to `POST /api/store` for keys not already covered by a targeted merge function.
- Client-side: send the last-known ETag/version with each write; on a 412 conflict response, show a clear message and offer to refetch/retry rather than silently discarding the user's edit or silently overwriting the server.
- Bundle: de-duplicate the 2–3 redundant `/store` GET requests observed per route (same data-fetching surface; fixing both together avoids touching this code path twice).

## 5. Out of scope
- Rewriting the whole-blob sync model into per-record REST resources (that is ARCH-001's long-term direction, not this package).
- Changing the existing targeted-merge logic for journals/products/repairs/outsource (already correct, leave as-is).
- Any UI redesign beyond the conflict message itself.

## 6. Likely affected components
- `app/api/store/route.ts` (add precondition check for non-merge-protected keys)
- Client sync layer in `lib/store.tsx` (the `sync()` helper and `useLS` hook's write path — attach version header, handle 412)
- New: a small conflict-notification UI component (or reuse existing toast infrastructure with a distinct, non-dismissible-until-acknowledged style given the significance of a lost-write warning)
- New: `__tests__/store-concurrency.test.ts`

## 7. Implementation instructions
1. Identify the full list of `deed_*` keys currently protected by a targeted merge (journals, products, repairs_v2, outsourceJobs/Payments/Vendors, content-filtered ledgers) — these keep their existing behavior unchanged.
2. For all other `deed_*` keys, compute a per-key version (reuse the existing weak-ETag computation already used by `GET /api/store`, or a simple `updated_at` timestamp comparison) and require the client to submit the version it last read for that key alongside its write.
3. If the submitted version does not match the current stored version, reject that specific key's write with a structured response (e.g. `{ conflicts: [{ key, currentVersion }] }`) while still accepting any other keys in the same request that have no conflict — do not fail the entire multi-key sync payload for one stale key.
4. In `lib/store.tsx`'s sync path, track the last-read version per key (already tracks `deed_dirty_keys`; extend similarly). On receiving a conflict response, do not silently retry with an overwrite — surface a clear, non-destructive message: "Someone else updated this while you were editing. Your changes were not saved. [Reload latest] [View my changes]" and preserve the user's in-progress edit in memory so they can decide (do not discard it automatically).
5. While in this file, address the duplicate-fetch issue: identify why each route issues 2–3 `/store` GETs (likely redundant mounts of the same data-fetching hook/provider at different component levels) and consolidate to a single shared fetch per route, using existing React context/provider patterns already in the codebase — do not introduce a new state-management library.
6. Add tests per §9.

## 8. Acceptance criteria
- Two simultaneous sessions editing the same non-merge-protected key: the second save receives a clear conflict response; no silent overwrite occurs; the user is told what happened and can act.
- Edits to different records within already-merge-protected keys continue to merge correctly (no regression).
- Each route issues at most one `/store` GET request per page load for a given key (verified via network-request count in an E2E or integration test).

## 9. Test plan
- **Unit:** version-mismatch detection logic; partial-key-conflict response shape.
- **Integration:** two-session concurrent write scenario against a non-merge-protected key.
- **Regression:** existing merge-protected key behavior (journals, products, repairs) unchanged.
- **E2E:** request-count assertion per route confirming deduplication.
- **Manual UAT:** two browser windows, same user or two users, edit the same settings screen concurrently; confirm the conflict message appears and no data is silently lost.

## 10. Evidence required from the implementing agent
Summary of changes; exact files; test commands + results; build result; before/after network-request-count evidence; risks (potential for over-aggressive conflict detection blocking legitimate rapid saves — tune the version granularity accordingly); rollback (feature flag per key group); unresolved issues.

## 11. Deployment plan
- **Branch:** `cursor/sec-005-concurrency-ddc8`
- **Staging:** deploy; run the two-session manual test against staging.
- **Migrations/env:** none required unless version tracking needs a new column (prefer reusing existing `updated_at`/ETag infrastructure to avoid a migration).
- **Smoke test:** normal single-user editing flow across several modules — confirm no false-positive conflicts under normal use.
- **Rollback trigger:** false-positive conflict rate high enough to disrupt normal single-user work → revert or widen the version-comparison tolerance.
