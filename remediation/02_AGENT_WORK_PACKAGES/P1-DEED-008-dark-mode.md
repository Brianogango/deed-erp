# P1-DEED-008 — Complete dark-mode token coverage

## 1. Task identity
- **Task ID:** P1-DEED-008 · **Priority:** P1 · **Severity:** High
- **Assigned agent type:** Frontend Agent
- **Related findings:** DEED-008 (Product Quality Audit); coordinate with P1-DEED-002-003 (focus-ring visibility in dark mode)
- **Business owner:** n/a · **Technical reviewer:** Tech lead

## 2. Plain-language objective
When a user switches to dark mode, every part of the screen — backgrounds, status labels, tabs, links — actually changes to a dark-mode-appropriate colour and stays easily readable. Nothing stays stuck in a bright light-mode colour that becomes illegible against a dark background.

## 3. Confirmed problem
- **Evidence:** Product Quality Audit measured, with `data-theme="dark"` set: `html` background correctly `rgb(11,18,32)` but `body` background stuck at `rgb(241,245,249)` (the light value); status pills on Finance measured `1.86:1` contrast (need 4.5:1) across 10 instances; inactive tabs `2.22:1`; active tab link `2.51:1`. `app/globals.css:123` confirms a `[data-theme='dark']` block exists, so the mechanism is real but incomplete — some elements read the dark tokens, others still reference hard-coded light values.
- **Reproduction:** toggle dark mode; inspect `body` background and any status pill's computed background/text colour.
- **Expected:** every themed surface, status pill, tab, link, input, and chart follows the dark token set; all pass WCAG AA contrast.
- **Root cause:** incremental token adoption — some components were migrated to the theme system, others retain hard-coded light-mode colours that the dark override never reaches.
- **Confidence:** High.

## 4. Scope
- Extend `[data-theme='dark']` in `app/globals.css` to cover: page body background, all card/surface backgrounds, text colours, borders, status pill backgrounds/text (per status type), tab active/inactive states, links, form inputs, and chart colours.
- Remove hard-coded light-mode colour values from any component found still bypassing the token system.
- Verify WCAG AA contrast for every status colour combination in dark mode.
- Verify across all 24 routes covered by the audit; capture before/after screenshots.

## 5. Out of scope
- Redesigning the light-mode palette (unchanged).
- Introducing a third theme or user-customizable themes.
- Any change to which routes/components exist — purely a colour-token completion pass.

## 6. Likely affected components
- `app/globals.css` (primary — the `[data-theme='dark']` block and every selector needing a dark counterpart)
- Any component with inline styles or hard-coded hex/rgb values bypassing CSS custom properties (search for hard-coded color values in `components/` that don't reference a CSS variable)
- Status-pill rendering component(s) across Finance, Repairs, Purchases, etc. (likely a shared badge/pill component — confirm exact location)
- New: a contrast-verification script or manual checklist per the audit's own methodology (computed style vs. resolved opaque background)

## 7. Implementation instructions
1. Audit `app/globals.css` for every CSS custom property defined for light mode and confirm a corresponding dark-mode override exists in the `[data-theme='dark']` block; list any gaps (start with `body` background, confirmed missing).
2. Fix `body`'s background to use the theme variable instead of a hard-coded light value.
3. For status pills specifically: identify the shared pill/badge component; ensure its background and text colours are driven by theme-aware variables per status (draft/posted/paid/cancelled/etc.), with each dark-mode pair independently checked for ≥4.5:1 contrast (the audit's own methodology — computed style against the resolved *opaque* background, learning from the audit's own correction note about gradient backgrounds causing false contrast failures elsewhere).
4. Fix inactive/active tab colours and link colours similarly.
5. Search for any component setting an inline `style={{ background: '#...' }}` or similar hard-coded value that should instead reference a CSS variable, and migrate those found to the token system (do not perform a speculative broad refactor beyond what's needed to fix the measured failures — this is a targeted completion, not the full DEED-037 design-system consolidation).
6. Re-run a contrast check (manual or scripted) against all 24 previously-audited routes in dark mode; capture screenshots.

## 8. Acceptance criteria
- `body` background follows the theme in dark mode.
- Every status pill combination measured by the audit reaches ≥4.5:1 contrast in dark mode.
- Tabs and links reach WCAG AA contrast in dark mode.
- All 24 audited routes visually verified in dark mode with before/after screenshots.

## 9. Test plan
- **Automated contrast check:** script or manual measurement against resolved backgrounds (not ancestor gradients — avoid the audit's own previously-corrected false-positive method).
- **Visual regression:** before/after screenshots per route.
- **Manual UAT:** toggle dark mode across Finance, Repairs, Purchases, Dashboard and confirm readability.

## 10. Evidence required from the implementing agent
Summary of changes; exact files; before/after screenshots for all 24 routes in dark mode; contrast measurements for every previously-failing combination, now passing; test commands + results; build result; risks (visual regression in light mode if a shared variable is touched incorrectly); rollback (CSS-only revert); unresolved issues.

## 11. Deployment plan
- **Branch:** `cursor/deed-008-dark-mode-ddc8`
- **Staging:** deploy; screenshot all 24 routes in both light and dark mode to confirm no light-mode regression.
- **Migrations/env:** none.
- **Smoke test:** toggle dark mode on the dashboard and finance module; confirm readability.
- **Rollback trigger:** any light-mode visual regression → revert the specific variable change.
