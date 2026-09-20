import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    reportSnapshot: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    backgroundJob: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    $queryRaw: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({ default: mockPrisma }))

import { __resetInfraRedisForTests, __redisTest, getInfraRedis } from '@/lib/infra/redis'
import { cacheGet, cacheGetOrSet, cacheSet } from '@/lib/infra/cache'
import { dequeueJob, enqueueJob, queueLength } from '@/lib/infra/queue'
import {
  __resetObjectStoreForTests,
  getObject,
  localObjectPath,
  putObject,
  sanitizeObjectKey,
  signS3Request,
} from '@/lib/infra/object-store'
import { readOptimisedReport, reportScopeKey, snapshotIsFresh } from '@/lib/infra/report-snapshots'
import { isSecretKey } from '@/lib/security/production-env'

const blobTmp = mkdtempSync(path.join(os.tmpdir(), 'deed-infra-blobs-'))
const uploadTmp = mkdtempSync(path.join(os.tmpdir(), 'deed-infra-uploads-'))
process.env.BLOB_STORE_DIR = blobTmp
process.env.UPLOADS_DIR = uploadTmp
process.env.OBJECT_STORE_DRIVER = 'fs'
delete process.env.REDIS_URL
delete process.env.UPSTASH_REDIS_REST_URL
delete process.env.UPSTASH_REDIS_REST_TOKEN
delete process.env.REPORTING_DATABASE_URL

beforeEach(() => {
  __resetInfraRedisForTests()
  __resetObjectStoreForTests()
  vi.clearAllMocks()
  mockPrisma.reportSnapshot.findUnique.mockResolvedValue(null)
  mockPrisma.reportSnapshot.upsert.mockImplementation(async ({ create }: { create: Record<string, unknown> }) => ({
    id: 'snap-1',
    ...create,
    generatedAt: create.generatedAt instanceof Date ? create.generatedAt : new Date(),
  }))
  mockPrisma.backgroundJob.findUnique.mockResolvedValue(null)
  mockPrisma.backgroundJob.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: data.id || 'job-1',
    ...data,
  }))
  mockPrisma.backgroundJob.update.mockResolvedValue({ id: 'job-1', status: 'queued' })
})

afterAll(() => {
  rmSync(blobTmp, { recursive: true, force: true })
  rmSync(uploadTmp, { recursive: true, force: true })
})

describe('infra redis', () => {
  it('encodes and parses RESP bulk strings', () => {
    const encoded = __redisTest.encodeCommand(['SET', 'k', 'v'])
    expect(encoded.toString()).toBe('*3\r\n$3\r\nSET\r\n$1\r\nk\r\n$1\r\nv\r\n')
    const parsed = __redisTest.parseOne(Buffer.from('$4\r\nping\r\n'), 0)
    expect(parsed).toEqual({ value: 'ping', next: 10 })
    expect(__redisTest.parseOne(Buffer.from('$-1\r\n'), 0)).toEqual({ value: null, next: 5 })
    expect(__redisTest.parseOne(Buffer.from(':12\r\n'), 0)).toEqual({ value: 12, next: 5 })
  })

  it('parses redis URLs including password and db', () => {
    expect(__redisTest.parseRedisUrl('redis://:redis-test-auth@127.0.0.1:6380/2')).toEqual({
      host: '127.0.0.1',
      port: 6380,
      password: 'redis-test-auth',
      db: 2,
    })
  })

  it('round-trips cache values through the memory backend', async () => {
    await cacheSet('deed:cache:demo', { ok: true, n: 3 }, 30)
    expect(await cacheGet('deed:cache:demo')).toEqual({ ok: true, n: 3 })
    const loader = vi.fn(async () => 'fresh')
    const first = await cacheGetOrSet('deed:cache:miss', 30, loader)
    const second = await cacheGetOrSet('deed:cache:miss', 30, loader)
    expect(first).toEqual({ value: 'fresh', source: 'live' })
    expect(second).toEqual({ value: 'fresh', source: 'cache' })
    expect(loader).toHaveBeenCalledTimes(1)
  })

  it('uses Redis lists as a FIFO queue', async () => {
    const a = await enqueueJob('reports', { type: 'refresh_core_reports', payload: { n: 1 } })
    const b = await enqueueJob('reports', { type: 'refresh_core_reports', payload: { n: 2 } })
    expect(await queueLength('reports')).toBe(2)
    expect(await dequeueJob('reports')).toMatchObject({ id: a.id, payload: { n: 1 } })
    expect(await dequeueJob('reports')).toMatchObject({ id: b.id, payload: { n: 2 } })
    expect(await dequeueJob('reports')).toBeNull()
  })

  it('supports setNx locks', async () => {
    const redis = await getInfraRedis()
    expect(await redis.setNx('lock:report', '1', 30)).toBe(true)
    expect(await redis.setNx('lock:report', '2', 30)).toBe(false)
  })
})

describe('object store', () => {
  it('sanitizes traversal in keys', () => {
    expect(sanitizeObjectKey('../etc/passwd')).toBe('etc/passwd')
    expect(sanitizeObjectKey('so-attachments/SO-1/file.pdf')).toBe('so-attachments/SO-1/file.pdf')
  })

  it('keeps blob files on the existing disk layout', async () => {
    await putObject({ bucket: 'blobs', key: 'expense_receipt_abc', body: 'data:image/png;base64,AAAA' })
    const file = localObjectPath('blobs', 'expense_receipt_abc')
    expect(file).toBe(path.join(blobTmp, 'expense_receipt_abc.blob'))
    expect(readFileSync(file, 'utf8')).toBe('data:image/png;base64,AAAA')
    expect(await getObject('blobs', 'expense_receipt_abc')).toEqual(Buffer.from('data:image/png;base64,AAAA'))
  })

  it('stores uploads under UPLOADS_DIR', async () => {
    await putObject({
      bucket: 'uploads',
      key: 'so-attachments/SO-9/file.pdf',
      body: Buffer.from('%PDF-1.4'),
      contentType: 'application/pdf',
    })
    const stored = await getObject('uploads', 'so-attachments/SO-9/file.pdf')
    expect(stored?.toString()).toBe('%PDF-1.4')
  })

  it('signs S3 requests with a stable AWS4 signature', () => {
    const signed = signS3Request({
      method: 'PUT',
      endpoint: 'https://s3.example.test',
      region: 'us-east-1',
      bucket: 'deed-erp',
      key: 'deed-erp/blobs/receipt.blob',
      accessKeyId: 'AKIAEXAMPLEKEYID',
      secretAccessKey: 'test-object-store-signing-key',
      body: Buffer.from('hello'),
      contentType: 'application/octet-stream',
      now: new Date('2026-09-20T12:00:00.000Z'),
      pathStyle: true,
    })
    expect(signed.url).toBe('https://s3.example.test/deed-erp/deed-erp/blobs/receipt.blob')
    expect(signed.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIAEXAMPLEKEYID\/20260920\/us-east-1\/s3\/aws4_request,/)
    expect(signed.headers.authorization).toContain('Signature=')
    expect(signed.headers['x-amz-content-sha256']).toHaveLength(64)
  })
})

describe('read-optimised reporting', () => {
  it('builds a stable snapshot scope key', () => {
    expect(reportScopeKey('trial_balance', { asOf: '2026-09-20' })).toBe('trial_balance:default::2026-09-20:2026-09-20')
    expect(reportScopeKey('profit_loss_management', { dateFrom: '2026-01-01', dateTo: '2026-09-20', view: 'management' }))
      .toBe('profit_loss_management:management:2026-01-01:2026-09-20:')
  })

  it('treats snapshots as stale after TTL or invalidation', () => {
    const generated = new Date('2026-09-20T12:00:00.000Z')
    expect(snapshotIsFresh(generated, { now: generated.getTime() + 1_000, ttlMs: 5_000 })).toBe(true)
    expect(snapshotIsFresh(generated, { now: generated.getTime() + 10_000, ttlMs: 5_000 })).toBe(false)
    expect(snapshotIsFresh(generated, {
      now: generated.getTime() + 1_000,
      ttlMs: 5_000,
      invalidatedAt: generated.getTime() + 500,
    })).toBe(false)
  })

  it('serves live compute, then cache, then snapshot', async () => {
    const live = vi.fn(async () => ({ netProfit: 4000, currency: 'KES' }))
    const first = await readOptimisedReport('profit_loss', { dateFrom: '2026-01-01', dateTo: '2026-09-20', view: 'flat' }, live)
    expect(first.netProfit).toBe(4000)
    expect(first._reporting.source).toBe('live')
    expect(live).toHaveBeenCalledTimes(1)
    expect(mockPrisma.reportSnapshot.upsert).toHaveBeenCalled()

    const second = await readOptimisedReport('profit_loss', { dateFrom: '2026-01-01', dateTo: '2026-09-20', view: 'flat' }, live)
    expect(second._reporting.source).toBe('cache')
    expect(live).toHaveBeenCalledTimes(1)
  })

  it('returns a stored snapshot without calling live when source=snapshot', async () => {
    mockPrisma.reportSnapshot.findUnique.mockResolvedValue({
      scopeKey: 'trial_balance:default::2026-09-20:2026-09-20',
      kind: 'trial_balance',
      payload: { balanced: true, totals: { debit: 10, credit: 10 } },
      generatedAt: new Date(),
    })
    const live = vi.fn(async () => ({ balanced: false }))
    const report = await readOptimisedReport(
      'trial_balance',
      { asOf: '2026-09-20' },
      live,
      { source: 'snapshot' },
    )
    expect(report.balanced).toBe(true)
    expect(report._reporting.source).toBe('snapshot')
    expect(live).not.toHaveBeenCalled()
  })
})

describe('infra secrets', () => {
  it('treats Redis and reporting database URLs as secrets', () => {
    expect(isSecretKey('REDIS_URL')).toBe(true)
    expect(isSecretKey('REPORTING_DATABASE_URL')).toBe(true)
    expect(isSecretKey('OBJECT_STORE_SECRET_ACCESS_KEY')).toBe(true)
  })
})
