import { describe, expect, it } from 'vitest'
import { normalizeMetricPath, recordHttpMetric, snapshotHttpMetrics } from '@/lib/http-metrics'

describe('http metrics', () => {
  it('normalizes ids out of paths', () => {
    expect(normalizeMetricPath('/api/invoices/123')).toBe('/api/invoices/:n')
    expect(normalizeMetricPath('/api/store?keys=deed_quotes')).toBe('/api/store')
  })

  it('counts 404s and timings', () => {
    const path = `/test-metrics-${Date.now()}`
    recordHttpMetric({ path, status: 404, ms: 12 })
    recordHttpMetric({ path, status: 200, ms: 8 })
    const row = snapshotHttpMetrics().paths.find(p => p.path === path)
    expect(row).toMatchObject({ hits: 2, status404: 1, maxMs: 12 })
    expect(row?.avgMs).toBe(10)
  })
})
