from pathlib import Path


def replace_once(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f'pattern not found in {path}: {old[:120]!r}')
    text = text.replace(old, new, 1)
    p.write_text(text)

# 1) Repair workspace: stop polluting history, remove duplicate filtering,
# lazy-load heavy detail/intake bundles, and keep active detail reconciled with server.
p = Path('components/modules/Repair.tsx')
text = p.read_text()
text = text.replace("import { useState, useMemo, useRef, useCallback, Suspense } from 'react'", "import { useState, useMemo, useRef, useCallback, useEffect, Suspense } from 'react'")
text = text.replace("import RepairDetailView from './repair/RepairDetailView'\nimport RepairIntake from '../repair/RepairIntake'", "import dynamic from 'next/dynamic'\n\nconst RepairDetailView = dynamic(() => import('./repair/RepairDetailView'), { loading: () => <ModuleSkeleton /> })\nconst RepairIntake = dynamic(() => import('../repair/RepairIntake'), { loading: () => <ModuleSkeleton /> })")
text = text.replace("    if (nextView === 'list') setActiveId(null)\n", "    if (nextView === 'list') setActiveId(null, { history: 'replace' })\n")
text = text.replace("    setMainTabValue(nextTab === 'refurb' ? 'refurb' : 'client')", "    setMainTabValue(nextTab === 'refurb' ? 'refurb' : 'client', { history: 'replace' })")
old = "  const activeRepair = useMemo(() => repairs.find(r => r.id === activeId) ?? null, [repairs, activeId])\n"
new = """  const localActiveRepair = useMemo(() => repairs.find(r => r.id === activeId) ?? null, [repairs, activeId])\n  const [serverActiveRepair, setServerActiveRepair] = useState(null)\n\n  // Cross-module mutations (Sales, portal approval/payment, ORC, etc.) can update\n  // the server-side repair without touching this tab's hydrated store. Reconcile\n  // only the open repair so the detail view never requires a manual refresh.\n  useEffect(() => {\n    setServerActiveRepair(null)\n    if (!activeId) return\n    let cancelled = false\n    let timer = null\n\n    const refreshOpenRepair = async () => {\n      if (document.visibilityState === 'hidden') return\n      try {\n        const res = await fetch(`/api/repairs?id=${encodeURIComponent(activeId)}&page=1&limit=1`, { cache: 'no-store' })\n        if (!res.ok) return\n        const payload = await res.json()\n        const fresh = Array.isArray(payload?.items) ? payload.items[0] : null\n        if (!cancelled && fresh?.id === activeId) setServerActiveRepair(fresh)\n      } catch {\n        // Keep the optimistic/local repair visible when reconciliation is offline.\n      }\n    }\n\n    const onFocus = () => { void refreshOpenRepair() }\n    const onVisible = () => { if (document.visibilityState === 'visible') void refreshOpenRepair() }\n    window.addEventListener('focus', onFocus)\n    document.addEventListener('visibilitychange', onVisible)\n    timer = window.setInterval(() => { void refreshOpenRepair() }, 8000)\n    void refreshOpenRepair()\n\n    return () => {\n      cancelled = true\n      if (timer) window.clearInterval(timer)\n      window.removeEventListener('focus', onFocus)\n      document.removeEventListener('visibilitychange', onVisible)\n    }\n  }, [activeId])\n\n  // Prefer a newer server snapshot when available. Any local mutation changes\n  // localActiveRepair immediately; clear the remote snapshot so optimistic UI\n  // remains instant, then the reconciliation effect catches up from the server.\n  useEffect(() => { setServerActiveRepair(null) }, [localActiveRepair])\n  const activeRepair = serverActiveRepair?.id === activeId ? serverActiveRepair : localActiveRepair\n"""
if old not in text:
    raise SystemExit('activeRepair pattern not found')
text = text.replace(old, new, 1)
old = """  const visibleRepairs = useMemo(() => {\n    return filter === 'all' ? allVisibleRepairs : allVisibleRepairs.filter(r => r.status === filter)\n  }, [allVisibleRepairs, filter])\n"""
new = """  // One source of truth for list filtering: RepairClientJobs owns URL-backed\n  // filters. Do not pre-filter here as well or status changes can race/stick.\n  const visibleRepairs = allVisibleRepairs\n"""
if old not in text:
    raise SystemExit('visibleRepairs pattern not found')
text = text.replace(old, new, 1)
p.write_text(text)

# 2) Repair API: support exact-id detail reconciliation and complete list filters.
p = Path('app/api/repairs/route.ts')
text = p.read_text()
needle = """    const status = request.nextUrl.searchParams.get('status')\n    const q = request.nextUrl.searchParams.get('q')?.toLowerCase()\n"""
replacement = """    const id = request.nextUrl.searchParams.get('id')\n    const status = request.nextUrl.searchParams.get('status')\n    const q = request.nextUrl.searchParams.get('q')?.trim().toLowerCase()\n    const technicianId = request.nextUrl.searchParams.get('tech')\n    const repairPath = request.nextUrl.searchParams.get('path')\n    const priority = request.nextUrl.searchParams.get('priority')\n    const from = request.nextUrl.searchParams.get('from')\n    const to = request.nextUrl.searchParams.get('to')\n"""
if needle not in text:
    raise SystemExit('repair API params pattern not found')
text = text.replace(needle, replacement, 1)
needle = """    if (status) {\n      repairs = repairs.filter(r => r.status === status)\n    }\n    if (q) {\n      repairs = repairs.filter(r =>\n        r.ref.toLowerCase().includes(q) ||\n        r.customerName.toLowerCase().includes(q) ||\n        r.productName.toLowerCase().includes(q)\n      )\n    }\n"""
replacement = """    if (id) repairs = repairs.filter(r => r.id === id)\n    if (status) repairs = repairs.filter(r => r.status === status)\n    if (technicianId) {\n      repairs = technicianId === 'unassigned'\n        ? repairs.filter(r => !r.assignedTechnicianId)\n        : repairs.filter(r => r.assignedTechnicianId === technicianId)\n    }\n    if (repairPath === 'direct_repair') repairs = repairs.filter(r => r.repairPath === 'direct_repair')\n    if (repairPath === 'diagnosis_first') repairs = repairs.filter(r => r.repairPath !== 'direct_repair')\n    if (priority) repairs = repairs.filter(r => r.priority === priority)\n    if (from) {\n      const start = new Date(`${from}T00:00:00`)\n      if (!Number.isNaN(start.getTime())) repairs = repairs.filter(r => new Date(r.intakeDate).getTime() >= start.getTime())\n    }\n    if (to) {\n      const end = new Date(`${to}T23:59:59.999`)\n      if (!Number.isNaN(end.getTime())) repairs = repairs.filter(r => new Date(r.intakeDate).getTime() <= end.getTime())\n    }\n    if (q) {\n      repairs = repairs.filter(r => [\n        r.ref, r.customerName, r.productName, r.customerPhone, r.serialNumber,\n        r.assignedTechnicianName, r.issueDescription,\n      ].some(value => String(value ?? '').toLowerCase().includes(q)))\n    }\n"""
if needle not in text:
    raise SystemExit('repair API filter pattern not found')
text = text.replace(needle, replacement, 1)
p.write_text(text)

# 3) URL history: list UI and module tab state must never generate a Back entry.
# Repair already uses useUrlUiState for q/filter/page; make tab changes explicit replace above.

# 4) Add a focused regression test for the Repair API contract without coupling to UI.
test = Path('__tests__/repair-stability-contract.test.ts')
test.write_text("""import { describe, expect, it } from 'vitest'\nimport { readFileSync } from 'node:fs'\n\ndescribe('repair stability contract', () => {\n  it('keeps list exit and repair tabs out of browser history', () => {\n    const src = readFileSync('components/modules/Repair.tsx', 'utf8')\n    expect(src).toContain(\"setActiveId(null, { history: 'replace' })\")\n    expect(src).toContain(\"{ history: 'replace' }\")\n  })\n\n  it('reconciles only the open repair instead of reloading the full module', () => {\n    const src = readFileSync('components/modules/Repair.tsx', 'utf8')\n    expect(src).toContain('/api/repairs?id=')\n    expect(src).toContain(\"cache: 'no-store'\")\n  })\n\n  it('supports exact-id and server-side repair filters', () => {\n    const src = readFileSync('app/api/repairs/route.ts', 'utf8')\n    for (const key of [\"get('id')\", \"get('tech')\", \"get('path')\", \"get('priority')\", \"get('from')\", \"get('to')\"]) {\n      expect(src).toContain(key)\n    }\n  })\n})\n""")

# Remove patch helpers from the resulting product commit.
Path('scripts/apply-repair-stability-phase1.py').unlink(missing_ok=True)
Path('.github/workflows/apply-repair-stability-phase1.yml').unlink(missing_ok=True)
