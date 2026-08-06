# Impeccable detector summary — Phase 2 redo

**Generated:** 2026-08-06  
**Command:** `node .cursor/skills/impeccable/scripts/detect.mjs --json` on  
`components/layout`, Dashboard, Sales, Inventory, RepairClientJobs, Refurbishment, `components/ui/index.tsx`

| Antipattern | Count | Severity |
|-------------|------:|----------|
| design-system-font-size | 331 | advisory |
| design-system-color | 137 | advisory |
| side-tab | 8 | warning |
| bounce-easing | 4 | warning |
| gray-on-color | 2 | warning |
| **Total** | **482** | 468 advisory / 14 warning |

## Top files

| File | Findings |
|------|--------:|
| components/modules/Inventory.tsx | 127 |
| components/modules/Dashboard.tsx | 82 |
| components/modules/Sales.tsx | 73 |
| components/modules/Refurbishment.tsx | 72 |
| components/ui/index.tsx | 44 |
| components/modules/RepairClientJobs.tsx | 27 |
| components/layout/Topbar.tsx | 26 |
| components/layout/GlobalSearch.tsx | 20 |
| components/layout/Sidebar.tsx | 11 |

## Warning examples

- `side-tab` — Inventory `border-l-4`; ui RecordCard/StatCard left borders  
- `bounce-easing` — GlobalSearch / Modal Confirm cubic-bezier bounce  
- `gray-on-color` — Sales / Inventory tinted panels with gray text  

Advisories largely mean arbitrary Tailwind sizes/colours are outside the documented DESIGN.md ramp — resolve by regenerating the design system in Phase 3, not by mass-editing every class in Phase 2.
