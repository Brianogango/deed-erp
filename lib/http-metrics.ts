/**
 * Process-local HTTP timing / 404 counters so we can see store and API
 * regressions without an external APM.
 *
 * Edge middleware and the Node server do not share this map. The GET
 * endpoint reads the Node isolate (API routes).
 */

export type HttpMetricRow = {
  path: string
  hits: number
  status404: number
  status4xx: number
  status5xx: number
  totalMs: number
  maxMs: number
}

type Store = {
  startedAt: string
  byPath: Map<string, HttpMetricRow>
}

const g = globalThis as unknown as { __deedHttpMetrics?: Store }
const store: Store =
  g.__deedHttpMetrics ?? (g.__deedHttpMetrics = { startedAt: new Date().toISOString(), byPath: new Map() })

export function normalizeMetricPath(pathname: string): string {
  const clean = (pathname || '/').split('?')[0]
  return clean
    .replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '/:uuid')
    .replace(/\/[0-9a-f]{24,}/gi, '/:id')
    .replace(/\/\d+/g, '/:n')
    .slice(0, 160) || '/'
}

export function recordHttpMetric(opts: { path: string; status: number; ms?: number }): void {
  const path = normalizeMetricPath(opts.path)
  const prev = store.byPath.get(path) ?? {
    path,
    hits: 0,
    status404: 0,
    status4xx: 0,
    status5xx: 0,
    totalMs: 0,
    maxMs: 0,
  }
  prev.hits += 1
  if (opts.status === 404) prev.status404 += 1
  if (opts.status >= 400 && opts.status < 500) prev.status4xx += 1
  if (opts.status >= 500) prev.status5xx += 1
  const ms = Math.max(0, opts.ms ?? 0)
  prev.totalMs += ms
  if (ms > prev.maxMs) prev.maxMs = ms
  store.byPath.set(path, prev)
}

export function snapshotHttpMetrics(): {
  startedAt: string
  capturedAt: string
  paths: Array<HttpMetricRow & { avgMs: number }>
} {
  const paths = [...store.byPath.values()]
    .map(row => ({
      ...row,
      avgMs: row.hits ? Math.round(row.totalMs / row.hits) : 0,
    }))
    .sort((a, b) => b.status404 - a.status404 || b.hits - a.hits)
  return { startedAt: store.startedAt, capturedAt: new Date().toISOString(), paths }
}
