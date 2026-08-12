import { describe, expect, it } from 'vitest'

/**
 * Pure helper mirroring CRM setTab / useUrlRecordId queryPatch merge —
 * guards against the Pipeline→Leads race where clearing `id` rebuilt the
 * URL from stale searchParams and restored crmTab=pipeline.
 */
function buildCrmTabUrl(
  currentQuery: string,
  next: { crmTab: string; clearId?: boolean; queryPatch?: Record<string, string | null> },
): string {
  const params = new URLSearchParams(currentQuery)
  if (next.clearId) params.delete('id')
  params.set('crmTab', next.crmTab)
  if (next.queryPatch) {
    for (const [key, value] of Object.entries(next.queryPatch)) {
      if (value === null) params.delete(key)
      else params.set(key, value)
    }
  }
  return params.toString()
}

describe('CRM tab URL navigation', () => {
  it('clears opportunity id and sets leads in one write (no pipeline clobber)', () => {
    const stale = 'crmTab=pipeline&id=opp-123'
    // Wrong approach: clear id from stale params without patching tab
    const bad = buildCrmTabUrl(stale, { crmTab: 'pipeline', clearId: true })
    expect(bad).toBe('crmTab=pipeline')

    // Correct: same replace also patches crmTab to leads
    const good = buildCrmTabUrl(stale, {
      crmTab: 'pipeline',
      clearId: true,
      queryPatch: { crmTab: 'leads' },
    })
    expect(good).toBe('crmTab=leads')
    expect(good).not.toContain('id=')
  })

  it('preserves unrelated query keys', () => {
    const qs = buildCrmTabUrl('crmTab=pipeline&id=x&foo=1', {
      crmTab: 'companies',
      clearId: true,
      queryPatch: { crmTab: 'companies' },
    })
    expect(qs).toContain('foo=1')
    expect(qs).toContain('crmTab=companies')
    expect(qs).not.toContain('id=')
  })
})
