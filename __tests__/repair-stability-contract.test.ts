import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

describe('repair stability contract', () => {
  it('keeps Repair list exits and tab switches out of browser history', () => {
    const src = readFileSync('components/modules/Repair.tsx', 'utf8')
    expect(src).toContain("setActiveId(null, { history: 'replace' })")
    expect(src).toContain("setMainTabValue(nextTab === 'refurb' ? 'refurb' : 'client', { history: 'replace' })")
  })

  it('reconciles only the open Repair without a full module refresh', () => {
    const src = readFileSync('components/modules/Repair.tsx', 'utf8')
    expect(src).toContain('/api/repairs/${encodeURIComponent(activeId)}')
    expect(src).toContain("cache: 'no-store'")
    expect(src).toContain("document.visibilityState === 'hidden'")
    expect(src).toContain('canApplyPolledRepair')
    expect(src).toContain('isDeedRepairsBlobDirty')
  })

  it('opens Refurbishment jobs in the Refurbishment module instead of Repair detail', () => {
    const src = readFileSync('components/modules/Repair.tsx', 'utf8')
    expect(src).toContain('openRefurbJob')
    expect(src).toContain('refurbishmentJobHref')
    expect(src).not.toContain("RepairRefurbJobs onSelect={(id) => { setActiveId(id); setView('detail') }}")
  })

  it('exposes an authoritative permission-scoped Repair detail GET', () => {
    const src = readFileSync('app/api/repairs/[id]/route.ts', 'utf8')
    expect(src).toContain('export async function GET')
    expect(src).toContain("filterStoreValueForRole")
    expect(src).toContain("'Cache-Control': 'no-store'")
  })

  it('lazy-loads heavy Repair detail and intake bundles', () => {
    const src = readFileSync('components/modules/Repair.tsx', 'utf8')
    expect(src).toContain("dynamic(() => import('./repair/RepairDetailView')")
    expect(src).toContain("dynamic(() => import('../repair/RepairIntake')")
  })
})
