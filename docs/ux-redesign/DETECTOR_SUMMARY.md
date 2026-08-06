# Detector summary — UX Phase 2 (Sales-focused)

**Command:** `node .cursor/skills/impeccable/scripts/detect.mjs components/modules/Sales.tsx …`

| File | Findings |
|------|----------|
| `components/modules/Sales.tsx` | 1 — `gray-on-color` (text-gray-600 on bg-blue-50) |
| `components/modules/sales/SalesRecordHeader.tsx` | 0 |
| `components/layout/Sidebar.tsx` | 0 (scoped) |
| `components/layout/Topbar.tsx` | 0 (scoped) |

**Total:** 1 anti-pattern in Sales sources for this pass.

Broader-repo purple/indigo issues (Dashboard, Inventory) were found by grep, not this detector run — tracked in Phase 2 audit as peer debt.
