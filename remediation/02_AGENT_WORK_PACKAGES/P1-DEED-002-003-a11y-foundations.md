# P1-DEED-002-003 — Verify and complete focus indicators and live-region announcements

## 1. Task identity
- **Task ID:** P1-DEED-002-003 · **Priority:** P1 · **Severity:** Medium (downgraded from the audit's Critical — groundwork already exists in code and requires verification, not invention)
- **Assigned agent type:** Frontend/Accessibility Agent
- **Related findings:** DEED-002 (focus indicators), DEED-003 (live regions) — kept as two acceptance-criteria sets per the master prompt's instruction to retain separate criteria for shared-root-cause findings
- **Business owner:** n/a · **Technical reviewer:** Tech lead

## 2. Plain-language objective
Anyone navigating with a keyboard can always see where they are on the screen, in both light and dark mode. Anyone using a screen reader is told when something succeeds, fails, or changes in the background — exactly once, never silently, never repeated.

## 3. Confirmed problem
- **Evidence (verified 5 Aug 2026):**
  - `app/globals.css` already contains multiple `:focus-visible` rules (lines 212–217 global; 586, 1432–1433, 1994, 3112 component-specific) — this directly contradicts the Product Quality Audit's "59 of 60 focusable elements have no visible focus indicator" finding as a *current* statement. Either the audit ran against an older deployed build, or coverage has gaps for specific custom controls (tabs, menus, table row actions, sidebar nav, dark mode) not covered by the existing rules.
  - `components/ui/index.tsx` already contains `aria-live="polite"` (line 319) and a dynamic `aria-live={isError ? 'assertive' : ...}` pattern (line 1659) plus another `aria-live="polite"` (line 1675) — this also contradicts "not a single aria-live region anywhere." Coverage across *all* async/success/warning/error states, and whether `role="alert"` is present on error toasts specifically, needs verification.
- **Reproduction:** this finding requires **production verification before further action** — tab through the 24 audited routes on the current deployed build and re-run the audit's ARIA-tree/computed-style harvester (or manually) to determine the actual current gap, since the code shows more coverage than the audit reported.
- **Expected:** every focusable element (including custom tabs/menus/table actions/sidebar/dark mode) shows a visible focus indicator; every toast/success/error/async-state change is announced exactly once via an appropriate live region, with `role="alert"` on errors.
- **Root cause:** likely a timing mismatch between when the audit was run and when these CSS/component changes were deployed, OR genuine coverage gaps on specific custom-built controls not using the shared primitives.
- **Confidence:** Medium — code inspection shows partial-to-full coverage; production/live verification is required to close the gap definitively before claiming this finding resolved.

## 4. Scope
- **Step 1 (verification, must happen first):** run a keyboard-only walkthrough plus an automated accessibility scan (axe or equivalent) against the current production or staging build across the 24 routes the Product Quality Audit covered. Produce a gap list.
- **Step 2 (remediation):** for any control found without a visible focus indicator, extend the existing `:focus-visible` token pattern to cover it — do not invent a new token system; reuse `app/globals.css`'s existing approach. Explicitly verify dark mode (`[data-theme='dark']`) contrast of the focus ring itself.
- **Step 3:** for any async/success/warning/error state found without an announcement, add the appropriate `aria-live="polite"` (informational) or `aria-live="assertive"` + `role="alert"` (errors) region, reusing the existing toast component's pattern rather than creating parallel mechanisms. De-duplicate any state found to announce twice.

## 5. Out of scope
- Full WCAG 2.1 AA audit of every possible interaction (that is Workstream I's broader AT-testing pass) — this package closes the two specific findings named.
- Removing native browser focus outlines without replacing them (never do this — `:focus-visible` should only ever restyle, never remove, unless a replacement is simultaneously applied in the same rule).
- Redesigning the toast/notification system's visual style — only its ARIA semantics are in scope.

## 6. Likely affected components
- `app/globals.css` (extend `:focus-visible` coverage as needed — confirm exact gap list from Step 1 before editing)
- `components/ui/index.tsx` (toast/notification component — extend `aria-live`/`role="alert"` coverage as needed)
- Any custom tab/menu/sidebar-nav components found lacking focus styles during Step 1 (exact list depends on verification findings — do not pre-guess)
- New: `__tests__/a11y-focus-live-regions.test.ts` or an axe-based E2E spec

## 7. Implementation instructions
1. **Do Step 1 (verification) before writing any fix.** Use an automated tool (axe-core via Playwright, since `e2e/` already exists in the repo) to scan the 24 routes for missing focus-visible styling and missing/incorrect live-region usage. Record the actual current gap — do not assume the audit's original numbers still apply given the code evidence above.
2. For each control in the gap list lacking a visible focus indicator, add or extend a `:focus-visible` rule following the existing pattern at `app/globals.css:212-217` (do not introduce inline styles or a competing CSS-in-JS approach).
3. Verify every added/existing focus ring meets contrast requirements against both light and dark backgrounds (use the same contrast-checking approach implied by the audit's methodology — computed style vs. resolved opaque background).
4. For each async/success/warning/error state in the gap list lacking an announcement, wire it into the existing toast/live-region component (`components/ui/index.tsx`) rather than adding new ad hoc `aria-live` attributes scattered through the codebase — centralization avoids future duplicate-announcement bugs.
5. Ensure error toasts specifically carry `role="alert"` (assertive) and success/info toasts carry `aria-live="polite"` — confirm the existing dynamic pattern at line 1659 already does this correctly, or fix it if not.
6. Check for and eliminate any duplicate announcement of the same state (e.g., both a toast and a separate live region firing for the same event).

## 8. Acceptance criteria
- Tabbing through each of the 24 previously-audited routes shows a visible focus indicator on every focusable element, in both light and dark mode.
- Every toast/success/warning/error/async-state change is announced via an appropriate live region exactly once.
- Error toasts carry `role="alert"`.
- No regression to existing working focus/live-region behavior.

## 9. Test plan
- **Automated:** axe-core scan across the 24 routes, before (baseline gap list) and after (zero remaining violations of the specific rules 2.4.7 and 4.1.3).
- **E2E:** keyboard-only navigation walkthrough of at least the top 5 workflows (aligned with the existing critical-workflow E2E suite from PR #225).
- **Manual UAT:** visual confirmation of focus ring visibility in dark mode specifically (a screenshot-diff check is reasonable if the visual-regression tooling from the design-system work is available).
- **Full screen-reader session (NVDA/VoiceOver):** deferred to Workstream I's dedicated AT-testing pass — not required to close this package, but flag any obvious issue found incidentally.

## 10. Evidence required from the implementing agent
Step 1's gap-list report (this is itself a required deliverable, not just an implementation step); before/after axe results; screenshots of focus rings in light and dark mode for a representative sample; test commands + results; build result; risks; rollback (CSS/component-level, low risk); unresolved issues (any control deferred due to complexity, with justification).

## 11. Deployment plan
- **Branch:** `cursor/deed-002-003-a11y-foundations-ddc8`
- **Staging:** run the Step 1 verification against staging first (cheaper than production) — deploy staging URL for axe scan if not already accessible.
- **Migrations/env:** none.
- **Smoke test:** manual keyboard walkthrough of dashboard, finance, repairs, contacts, purchases (the routes most referenced across all three audit documents).
- **Rollback trigger:** any CSS change visually breaks an unrelated element → revert that specific rule.
