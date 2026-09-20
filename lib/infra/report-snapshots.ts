import 'server-only'
import { cacheGet, cacheSet, cacheIncr } from '@/lib/infra/cache'
import { enqueueDurableJob } from '@/lib/infra/jobs'
import { getInfraRedis } from '@/lib/infra/redis'
import { getOperationalPrisma, getReportingPrisma } from '@/lib/infra/reporting-db'

export type ReportKind = 'profit_loss' | 'profit_loss_management' | 'trial_balance' | 'balance_sheet'

export type ReportSource = 'cache' | 'snapshot' | 'snapshot_stale' | 'live'

export type ReportParams = {
  dateFrom?: string | null
  dateTo?: string | null
  asOf?: string | null
  view?: string | null
}

export type ReportEnvelope<T> = T & {
  _reporting: {
    kind: ReportKind
    source: ReportSource
    generatedAt: string
    ageMs: number
    stale: boolean
  }
}

const INVALIDATED_AT_KEY = 'deed:report:invalidatedAt'
const GEN_KEY = 'deed:report:gen'

function envSeconds(name: string, fallback: number) {
  const raw = Number(process.env[name] || '')
  return Number.isFinite(raw) && raw > 0 ? raw : fallback
}

export function reportCacheTtlSeconds() {
  return envSeconds('REPORT_CACHE_TTL_SECONDS', 60)
}

export function reportSnapshotTtlSeconds() {
  return envSeconds('REPORT_SNAPSHOT_TTL_SECONDS', 300)
}

export function reportScopeKey(kind: ReportKind, params: ReportParams = {}): string {
  const view = String(params.view || (kind === 'profit_loss_management' ? 'management' : 'default'))
  const from = params.dateFrom || ''
  const to = params.dateTo || params.asOf || ''
  const asOf = params.asOf || ''
  return [kind, view, from, to, asOf].join(':')
}

function cacheKeyFor(scopeKey: string, generation: string) {
  return `deed:report:${generation}:${scopeKey}`
}

async function generation(): Promise<string> {
  try {
    const redis = await getInfraRedis()
    return String((await redis.get(GEN_KEY)) || '0')
  } catch {
    return '0'
  }
}

async function invalidatedAt(): Promise<number> {
  try {
    const redis = await getInfraRedis()
    return Number((await redis.get(INVALIDATED_AT_KEY)) || '0') || 0
  } catch {
    return 0
  }
}

export function snapshotIsFresh(generatedAt: Date | string, opts?: { now?: number; invalidatedAt?: number; ttlMs?: number }) {
  const generated = generatedAt instanceof Date ? generatedAt.getTime() : Date.parse(generatedAt)
  if (!Number.isFinite(generated)) return false
  const now = opts?.now ?? Date.now()
  const ttlMs = opts?.ttlMs ?? reportSnapshotTtlSeconds() * 1000
  if (now - generated > ttlMs) return false
  if (opts?.invalidatedAt && generated < opts.invalidatedAt) return false
  return true
}

export async function invalidateReportingPath(): Promise<void> {
  try {
    const redis = await getInfraRedis()
    await redis.set(INVALIDATED_AT_KEY, String(Date.now()))
    await cacheIncr(GEN_KEY)
  } catch {
    // memory/redis optional
  }
  await enqueueDurableJob({
    type: 'refresh_core_reports',
    uniqueKey: 'refresh_core_reports',
    payload: { reason: 'journal_post' },
  }).catch(() => {})
}

function wrap<T extends object>(kind: ReportKind, data: T, source: ReportSource, generatedAt: string): ReportEnvelope<T> {
  const generated = Date.parse(generatedAt) || Date.now()
  return {
    ...data,
    _reporting: {
      kind,
      source,
      generatedAt,
      ageMs: Math.max(0, Date.now() - generated),
      stale: source === 'snapshot_stale',
    },
  }
}

async function loadSnapshot(scopeKey: string) {
  return getOperationalPrisma().reportSnapshot.findUnique({
    where: { scopeKey },
  })
}

async function saveSnapshot(kind: ReportKind, params: ReportParams, payload: unknown) {
  const scopeKey = reportScopeKey(kind, params)
  const generatedAt = new Date()
  return getOperationalPrisma().reportSnapshot.upsert({
    where: { scopeKey },
    create: {
      scopeKey,
      kind,
      params: params as object,
      payload: payload as object,
      generatedAt,
    },
    update: {
      kind,
      params: params as object,
      payload: payload as object,
      generatedAt,
    },
  })
}

type LiveLoader<T> = () => Promise<T>

export async function readOptimisedReport<T extends object>(
  kind: ReportKind,
  params: ReportParams,
  live: LiveLoader<T>,
  opts?: { source?: string | null },
): Promise<ReportEnvelope<T>> {
  const source = String(opts?.source || 'auto').toLowerCase()
  const scopeKey = reportScopeKey(kind, params)
  const ttlSeconds = reportCacheTtlSeconds()
  const snapshotTtlMs = reportSnapshotTtlSeconds() * 1000
  const gen = await generation()
  const cacheKey = cacheKeyFor(scopeKey, gen)
  const invalidated = await invalidatedAt()

  if (source !== 'live') {
    const cached = await cacheGet<ReportEnvelope<T>>(cacheKey)
    if (cached && cached._reporting) return { ...cached, _reporting: { ...cached._reporting, source: 'cache', ageMs: Date.now() - Date.parse(cached._reporting.generatedAt || '') } }

    const snapshot = await loadSnapshot(scopeKey).catch(() => null)
    if (snapshot) {
      const generatedAt = snapshot.generatedAt.toISOString()
      const fresh = snapshotIsFresh(snapshot.generatedAt, { invalidatedAt: invalidated, ttlMs: snapshotTtlMs })
      if (fresh || source === 'snapshot') {
        const envelope = wrap(kind, snapshot.payload as T, fresh ? 'snapshot' : 'snapshot_stale', generatedAt)
        if (fresh) await cacheSet(cacheKey, envelope, ttlSeconds)
        if (fresh || source === 'snapshot') return envelope
      }
    } else if (source === 'snapshot') {
      throw Object.assign(new Error('Report snapshot is not available yet'), { status: 409 })
    }
  }

  try {
    const data = await live()
    const generatedAt = new Date().toISOString()
    const envelope = wrap(kind, data, 'live', generatedAt)
    await Promise.all([
      saveSnapshot(kind, params, data).catch(() => null),
      cacheSet(cacheKey, envelope, ttlSeconds),
    ])
    return envelope
  } catch (err) {
    const snapshot = await loadSnapshot(scopeKey).catch(() => null)
    if (snapshot) {
      return wrap(kind, snapshot.payload as T, 'snapshot_stale', snapshot.generatedAt.toISOString())
    }
    throw err
  }
}

export async function refreshReportSnapshot(kind: ReportKind, params: ReportParams, live: LiveLoader<object>) {
  const data = await live()
  await saveSnapshot(kind, params, data).catch(() => null)
  const envelope = wrap(kind, data, 'live', new Date().toISOString())
  const gen = await generation()
  await cacheSet(cacheKeyFor(reportScopeKey(kind, params), gen), envelope, reportCacheTtlSeconds())
  return envelope
}

export async function refreshCoreReportSnapshots() {
  const {
    buildBalanceSheet,
    buildManagementProfitAndLoss,
    buildProfitAndLoss,
    buildTrialBalance,
  } = await import('@/lib/accounting/gl-reports')

  const today = new Date().toISOString().slice(0, 10)
  const year = today.slice(0, 4)
  const yearStart = `${year}-01-01`
  const results = await Promise.allSettled([
    refreshReportSnapshot('profit_loss_management', { dateFrom: yearStart, dateTo: today, view: 'management' }, () =>
      buildManagementProfitAndLoss({ dateFrom: yearStart, dateTo: today })),
    refreshReportSnapshot('profit_loss', { dateFrom: yearStart, dateTo: today, view: 'flat' }, () =>
      buildProfitAndLoss({ dateFrom: yearStart, dateTo: today })),
    refreshReportSnapshot('trial_balance', { asOf: today }, () => buildTrialBalance({ asOf: today })),
    refreshReportSnapshot('balance_sheet', { asOf: today }, () => buildBalanceSheet({ asOf: today })),
  ])

  return {
    ok: results.every(result => result.status === 'fulfilled'),
    refreshed: results.filter(result => result.status === 'fulfilled').length,
    failed: results.filter(result => result.status === 'rejected').length,
    asOf: today,
    reportingDatabase: Boolean(process.env.REPORTING_DATABASE_URL),
  }
}

export function reportingReadClient() {
  return getReportingPrisma()
}
