# P2-DEED-QW — Bundle of small UI/consistency corrections

## 1. Task identity
- **Task ID:** P2-DEED-QW · **Priority:** P2 · **Severity:** Low-Medium
- **Assigned agent type:** Frontend Agent
- **Related findings:** DEED-013…041 quick-win subset (SOPs message, ⌘K hint, date mask, More-menu text, duplicate date, `/after-sales` route, `transition: all`, date-format consistency, 11 HR icon labels, 4 unlabelled inputs, success-green contrast, duplicate `h1`)
- **Business owner:** minor input on date-format choice (recommend `DD MMM YYYY` app-wide) · **Technical reviewer:** Tech lead

## 2. Plain-language objective
A bundle of small, quick corrections that make the app feel more polished and remove minor annoyances — each one is small enough to fix and verify independently, but grouped here so they ship together as one low-risk pass.

## 3. Confirmed problem
Each item below is independently confirmed by the Product Quality Audit's measurements:
- **My Documents "No SOPs yet"** shown incorrectly in a context where it doesn't apply.
- **`Ctrl+K` hint** shown even on Mac, where it should read `⌘K`.
- **Date mask bug:** an input showing a literal `dd-----yyyy` placeholder instead of a proper mask.
- **"More" menu spelled three ways:** `More ▾` (Purchases), `More▾` (Operations/CRM/Kilimall), `More` + separate chevron (Finance) — HR contains both variants simultaneously.
- **Duplicate date on dashboard:** "Wed, 5 Aug 2026" (header) and "Wed, 5 Aug" (banner) in two different formats.
- **`/after-sales` returns 404** while `/aftersales` (no hyphen) works — confirmed absent via direct directory check (`app/aftersales` exists, `app/after-sales` does not).
- **`transition: all`** used on the notifications panel — inefficient and can cause unintended animation of unrelated properties.
- **27 distinct font sizes / two date formats app-wide** (`D MMM YYYY` on all 24 routes, `DD MMM YYYY` on 14 routes) — this package addresses only the date-format half as a quick win; the font-size consolidation is DEED-037 (P3).
- **11 unlabelled icon buttons on `/hr`**, **4 unlabelled inputs** (POS, Reconfiguration ×2, Settings) — WCAG 4.1.2/3.3.2.
- **Success-green contrast:** `rgb(5,150,105)` on white measured at 3.77:1 (need 4.5:1) across 21 instances — audit recommends darkening to emerald-700.
- **Duplicate `h1`:** 22 of 24 routes have two top-level headings — WCAG 1.3.1.

## 4. Scope
Each item is its own commit within this single branch:
1. Fix My Documents empty-state message logic.
2. Platform-detect (`navigator.platform` or equivalent) to show `⌘K` on Mac, `Ctrl+K` elsewhere.
3. Fix the date-input mask that renders as literal `dd-----yyyy`.
4. Standardize "More" menu label + chevron across Purchases/Operations/CRM/Kilimall/Finance/HR to one consistent implementation.
5. Remove the duplicate dashboard date display, or make both instances consistent and clearly differentiated in purpose (e.g. one is "today", the other is a report-period label — if so, label them, don't just deduplicate blindly).
6. Add a redirect from `/after-sales` to `/aftersales` (or vice versa — pick the canonical route and 301-redirect the other; do not maintain two live routes for the same module).
7. Replace `transition: all` on the notifications panel with an explicit property list.
8. Standardize on one date format app-wide (recommend `DD MMM YYYY` per the audit's own noted preference direction, pending the minor business input in §1).
9. Add `aria-label` to the 11 unlabelled HR icon buttons.
10. Add labels to the 4 remaining unlabelled inputs (POS, Reconfiguration ×2, Settings).
11. Darken the success-green token to `emerald-700` (or equivalent ≥4.5:1-passing shade) everywhere it's used as text-on-white.
12. Fix duplicate `h1` on the 22 affected routes — typically one is the page title and one is a redundant section heading; demote the redundant one to `h2` or remove it, preserving visual style via CSS class rather than heading level where the visual weight must stay the same.

## 5. Out of scope
- Full font-size/design-token consolidation (DEED-037, separate P3 package).
- Any change to business logic — every item here is presentation/labelling only.
- Adding automated route-name renaming beyond the one `/after-sales` redirect (broader route-naming cleanup, e.g. KPI Targets living at `/sops`, is a separate, larger navigation-restructuring conversation not included here since it may affect bookmarks/links more broadly — flag it as a candidate for a future, explicitly-scoped package rather than bundling it into this low-risk pass).

## 6. Likely affected components
- My Documents component (`components/modules/MyDocuments.tsx`)
- Command palette hint rendering (locate the Ctrl+K hint component)
- Date-input component with the mask bug (locate via search for `dd-----yyyy` or the mask library/pattern in use)
- "More" menu implementations across Purchases/Operations/CRM/Kilimall/Finance/HR modules and any shared overflow-menu component (`components/data-table/TableOverflowMenu.tsx` is a likely consolidation target)
- Dashboard date-display components (`components/modules/Dashboard.tsx`)
- `next.config.js` or a routing redirect mechanism for `/after-sales` → `/aftersales`
- Notifications panel component (for the `transition: all` fix)
- Global date-formatting utility (locate the shared date-format helper, likely in `lib/` — confirm before touching every call site)
- HR module icon buttons (`components/modules/HR.tsx` and/or `HRSettings.tsx`)
- POS, Reconfiguration (`components/modules/Reconfiguration.tsx`), Settings unlabelled inputs
- `app/globals.css` (success-green token)
- Each of the 22 routes with a duplicate `h1` (identify via the same ARIA-tree-style inspection the audit used, or a simple DOM query per route)

## 7. Implementation instructions
Work through the 12 items as independent commits in the order listed in §4. For each:
1. Locate the exact component via the file hints in §6.
2. Make the minimal, targeted change described in §4.
3. Verify the specific measurement the audit used to detect the issue no longer reproduces (e.g., for item 11, re-check the success-green contrast ratio; for item 6, confirm `/after-sales` now redirects with a 301, not a 404).
4. Commit with a message referencing the specific DEED-0xx id it closes.

For item 8 (date-format standardization), this is the largest item in the bundle: locate every call site currently using the non-standard format, migrate to the shared date-formatting utility if one exists (or create one if formats are currently inlined ad hoc across components), and verify no downstream code parses the formatted string back (a display-format change should never affect any stored-data format).

## 8. Acceptance criteria
Each numbered item in §4 has its own pass/fail check:
1. My Documents shows the correct contextual message.
2. Command-palette hint reads `⌘K` on Mac, `Ctrl+K` elsewhere.
3. Date input shows a proper mask, not literal dashes.
4. "More" menu renders identically (label + chevron) across all six audited surfaces.
5. Dashboard shows one clearly-purposed date display, or two distinctly labelled ones.
6. `/after-sales` redirects (301) to the canonical route; no 404.
7. Notifications panel no longer uses `transition: all`.
8. All 24 routes use the same date format.
9. All 11 previously-unlabelled HR icon buttons have accessible names.
10. All 4 previously-unlabelled inputs have accessible labels.
11. Success-green text-on-white reaches ≥4.5:1 contrast everywhere measured.
12. No route has two `h1` elements.

## 9. Test plan
- **Automated:** axe-core scan re-run on all 24 routes; assert the specific violations closed (items 9–12).
- **Unit:** date-format utility output; platform-detection hint logic.
- **E2E:** `/after-sales` redirect test.
- **Visual:** screenshots confirming the "More" menu and dashboard date items.
- **Manual UAT:** spot-check each of the 12 items against its original audit evidence.

## 10. Evidence required from the implementing agent
Per-item before/after evidence (screenshot or measurement) matching the audit's own methodology; full commit list mapped to DEED-0xx ids; test commands + results; build result; risks (date-format migration touching many call sites — confirm no stored-format regression); rollback (each item is an independent, easily revertible commit).

## 11. Deployment plan
- **Branch:** `cursor/deed-qw-quick-wins-ddc8`
- **Staging:** deploy; re-run the axe scan and the specific manual checks for all 12 items.
- **Migrations/env:** none.
- **Smoke test:** navigate all 24 routes; confirm no visual regression beyond the intended fixes.
- **Rollback trigger:** any single item causing a regression can be reverted independently via its own commit without affecting the other 11.
