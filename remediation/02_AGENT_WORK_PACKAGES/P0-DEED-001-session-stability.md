# P0-DEED-001 — Session stability, expiry warning, and form-draft autosave

## 1. Task identity
- **Task ID:** P0-DEED-001 · **Priority:** P0 · **Severity:** Critical
- **Assigned agent type:** Frontend Agent (+ small backend change for session refresh)
- **Related findings:** DEED-001 (Product Quality Audit); closes SEC-004 (cross-user data residue) as a bundled logout-teardown fix
- **Business owner:** Director (confirms session-length/warning policy — Decision 4) · **Technical reviewer:** Tech lead; auth-adjacent, treat with care

## 2. Plain-language objective
A user is never silently thrown out of the app mid-task. Before a login expires they get a clear warning and a chance to stay logged in. If they do get logged out, they land back on the exact page they were working on, and any half-finished repair intake, quotation, or journal entry can be recovered — never silently lost.

## 3. Confirmed problem
- **Evidence (verified 5 Aug 2026, master@38b75aa):**
  - `lib/auth/session.ts:4`: `export const SESSION_TTL_SECONDS = 60 * 60 * 12` (12 hours), fixed at issuance (`expiresAt` set once, line ~53); no sliding refresh found.
  - `middleware.ts`: redirects to `/login` on an invalid/expired session with no `returnTo` parameter preserved (confirmed by inspecting the redirect call sites — no query param carrying the original path).
  - No draft-autosave mechanism exists in the codebase for any long-running form (repair intake, quotation, journal entry) — `lib/store.tsx`'s `useLS` hook persists whole domain arrays to localStorage, not in-progress form state.
  - No logout handler was found that explicitly purges `deed_*` business keys from localStorage (SEC-004 residual).
- **Reproduction:** log in, wait past session expiry (or force-expire in a test session), attempt any action → redirected to `/login` with no explanation; in-progress form state is gone; after logging back in, user lands on the default page, not where they were.
- **Expected:** warning before expiry with an option to extend; return-to-original-page after re-login; recoverable draft for long forms; business data cleared from localStorage on explicit logout.
- **Root cause:** session lifecycle was built for correctness (fail-closed, per PR #217) but not for UX continuity; no draft layer was ever built.
- **Confidence:** High.

## 4. Scope
- Server: sliding session refresh — re-issue the session cookie with a new `expiresAt` when a request arrives within a configurable threshold of the current expiry (e.g. last 2 hours of a 12-hour session), without extending indefinitely (define a maximum absolute session lifetime to prevent unbounded sessions — e.g. hard cap at 24 hours from original login regardless of activity).
- Frontend: an expiry-warning UI (modal/banner) shown a configurable number of minutes before expiry, with an "Extend session" action that pings a lightweight endpoint to trigger the refresh, and a visible countdown.
- Middleware: preserve the originally requested path as a `returnTo` param on the redirect to `/login`; `/login` honors it after successful auth.
- A generic draft-autosave hook, namespaced per user and per form, applied first to: repair intake, quotation (Sales), and journal-entry (Accounting) forms — the three explicitly named in the audit and the master prompt.
- Draft restore prompt shown when the same user reopens the same form and a draft exists.
- Logout handler: explicitly clear all `deed_*` localStorage keys (business data) and any drafts on explicit logout.
- Tests for all of the above.

## 5. Out of scope
- Changing the underlying auth mechanism (next-auth JWT / session cookie technology) — only its lifecycle/refresh behavior changes.
- Extending draft-autosave to every form in the app in this package (three named forms only; a follow-up P2 item can extend the pattern).
- Any weakening of session security (e.g. no increase to the absolute maximum lifetime beyond what is explicitly decided; no removal of fail-closed behavior from PR #217).
- Storing passwords, tokens, or other secrets in any draft (explicitly forbidden — enforce via a field-exclusion list in the draft serializer).

## 6. Likely affected components
- `lib/auth/session.ts` (refresh logic, absolute-lifetime cap)
- `middleware.ts` (returnTo preservation)
- `app/login/page.tsx` and `components/modules/Login.tsx` (honor returnTo post-auth)
- `components/AppShell.tsx` (session-warning UI mount point, logout handler)
- New: `hooks/useFormDraft.ts` (generic draft-autosave/restore hook)
- Repair intake form, Sales quotation form, Accounting journal-entry form (locate exact files under `components/modules/repair/`, sales quotation component, `components/modules/Accounting.tsx` or accounting journal component — confirm exact paths during implementation via grep for the form's submit handler before editing)
- New: `__tests__/session-refresh.test.ts`, `__tests__/form-draft.test.ts`
- New: `e2e/session-expiry-draft.spec.ts`

## 7. Implementation instructions
1. In `lib/auth/session.ts`, add a `REFRESH_THRESHOLD_SECONDS` constant (e.g. 2 hours) and an `ABSOLUTE_MAX_SESSION_SECONDS` cap (e.g. 24 hours from original `issuedAt`, not from each refresh — prevents indefinite sessions from continuous activity). On each authenticated request in `middleware.ts`, if `expiresAt - now < REFRESH_THRESHOLD_SECONDS` and `now - issuedAt < ABSOLUTE_MAX_SESSION_SECONDS`, re-issue the session cookie with a new `expiresAt = now + SESSION_TTL_SECONDS` (capped at the absolute maximum). Do not refresh on every request (cost); refresh at most once per some interval (e.g. once per 15 minutes of activity) to avoid excessive cookie churn.
2. Expose the current session's `expiresAt` to the client (e.g. via a lightweight `GET /api/auth/session-status` endpoint or embedded in the existing session bootstrap payload) so the frontend can compute a countdown without polling aggressively.
3. Build a session-warning component mounted in `AppShell.tsx`: polls or uses a timer against the known `expiresAt`; at T-minus-N-minutes (configurable, default 5) shows a non-blocking modal: "Your session will expire soon. [Stay signed in] [Log out now]". "Stay signed in" calls a `POST /api/auth/refresh` (or reuses any authenticated GET to trigger the middleware refresh) and updates the countdown.
4. In `middleware.ts`, when redirecting an unauthenticated/expired request to `/login`, append `?returnTo=<original-encoded-path>`. In the login flow, after successful authentication, read `returnTo` from the query string and redirect there instead of the default landing page. Validate `returnTo` is a same-origin relative path (reject absolute URLs to prevent open-redirect).
5. Build `hooks/useFormDraft.ts`: `useFormDraft(formKey: string, currentValues: T, options?: { exclude?: (keyof T)[] })`. Debounced (~1s) write to `localStorage` under a per-user-namespaced key (`draft_${userId}_${formKey}`); the serializer must strip any field named/matching a password/secret/token pattern and any field explicitly listed in `exclude`. On mount, if a draft exists and is newer than a TTL (e.g. 24 hours), surface a restore prompt: "You have an unsaved [Repair Intake / Quotation / Journal Entry] from [time]. [Restore] [Discard]". Clear the draft on successful form submission.
6. Wire `useFormDraft` into the three named forms — for each, identify the top-level form-state object already used by the component (do not restructure existing form state; the hook observes and persists it) before editing.
7. Add an explicit logout handler (wherever the current logout action lives — locate via search for the sign-out call) that iterates `localStorage` keys, removes every key starting with `deed_` and every key starting with `draft_`, then proceeds with the existing sign-out request. This directly resolves SEC-004.
8. Add tests per §9.

## 8. Acceptance criteria
- A session expiration never silently destroys form work: the user sees a warning before expiry with time remaining.
- Extending the session works without page reload or data loss.
- After a session does expire and the user re-authenticates, they are returned to the original route (or its nearest valid parent if the route required stale IDs).
- A recoverable draft is offered for repair intake, quotation, and journal-entry forms after any interruption (session expiry, browser refresh, tab close/reopen).
- No password, token, or secret field is ever present in a stored draft (verified by test).
- After explicit logout, no `deed_*` business data remains in `localStorage` (closes SEC-004).
- The absolute session lifetime cap is enforced regardless of refresh activity.

## 9. Test plan
- **Unit:** draft serializer excludes sensitive fields; session refresh threshold/cap math.
- **Integration:** middleware returnTo round-trip; refresh endpoint extends `expiresAt` correctly and respects the absolute cap.
- **E2E:** start a repair intake, force session expiry, observe warning → decline → redirected with returnTo → log back in → land on original page → draft-restore prompt appears → restore → data intact.
- **E2E:** explicit logout → inspect localStorage → no `deed_*` keys remain.
- **Manual UAT:** repeat the above for quotation and journal-entry forms; verify countdown UI is not intrusive during normal use.

## 10. Evidence required from the implementing agent
Summary of changes; exact files; before/after screenshots of the warning modal and restore prompt; test commands + results; build result; risks (e.g. cookie-refresh cost under load); rollback procedure (feature-flag the draft layer and the warning UI independently so either can be disabled without reverting the session-refresh fix); unresolved issues.

## 11. Deployment plan
- **Branch:** `cursor/deed-001-session-stability-ddc8`
- **Staging:** deploy; manually force-expire a staging session (adjust `SESSION_TTL_SECONDS` temporarily in a staging-only env override, or use a test account with a short-lived session) and walk through the full E2E scenario.
- **Migrations/env:** none required; optionally add `SESSION_REFRESH_THRESHOLD_SECONDS` / `SESSION_ABSOLUTE_MAX_SECONDS` as env-overridable constants for staging tuning.
- **Smoke test:** login → work in a form → simulate near-expiry → warning appears → extend → continue working, uninterrupted.
- **Human gate:** business owner confirms session length and warning lead time (Decision 4) before production.
- **Production:** standard deploy; monitor for any increase in login-redirect-loop error reports in the first 48 hours.
- **Rollback trigger:** returnTo redirect creates a loop, or session refresh causes unexpected logouts → disable via feature flag first, full revert if needed.
