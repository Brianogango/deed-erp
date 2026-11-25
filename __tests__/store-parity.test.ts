import { describe, expect, it, vi, beforeEach } from 'vitest'

const mockQueryRaw = vi.fn()
const mockPublish = vi.fn()

vi.mock('@/lib/prisma', () => ({
  default: { $queryRaw: (...args: unknown[]) => mockQueryRaw(...args) },
}))
vi.mock('@/lib/notifications/service', () => ({
  publishNotificationEvent: (...args: unknown[]) => mockPublish(...args),
}))

import { checkStoreParity, runStoreParityJob } from '@/lib/store-parity'

/**
 * The module issues three raw queries in order: app_state counts, the
 * to_regclass existence probe, then the projection counts. The helper replies
 * to them in that order.
 */
function respond({ app, projectionExists = true, projection = [] as Array<{ key: string; n: number }> }: {
  app: Array<{ key: string; n: number }>
  projectionExists?: boolean
  projection?: Array<{ key: string; n: number }>
}) {
  mockQueryRaw.mockReset()
  mockQueryRaw
    .mockResolvedValueOnce(app)
    .mockResolvedValueOnce([{ reg: projectionExists ? 'erp_state_records' : null }])
    .mockResolvedValueOnce(projection)
}

beforeEach(() => {
  mockQueryRaw.mockReset()
  mockPublish.mockReset()
  mockPublish.mockResolvedValue({ id: 'evt' })
})

describe('store parity check', () => {
  it('reports parity when both layers hold the same counts', async () => {
    respond({
      app: [{ key: 'deed_serials', n: 120 }, { key: 'deed_stockMoves', n: 44 }],
      projection: [{ key: 'deed_serials', n: 120 }, { key: 'deed_stockMoves', n: 44 }],
    })
    const report = await checkStoreParity()
    expect(report.inParity).toBe(true)
    expect(report.drifted).toEqual([])
    expect(report.projectionAvailable).toBe(true)
  })

  it('flags a key where Prisma is behind the copy, with a signed drift', async () => {
    respond({
      app: [{ key: 'deed_serials', n: 120 }],
      projection: [{ key: 'deed_serials', n: 118 }],
    })
    const report = await checkStoreParity()
    expect(report.inParity).toBe(false)
    expect(report.drifted).toEqual([
      { key: 'deed_serials', appStateCount: 120, projectionCount: 118, drift: -2 },
    ])
  })

  it('flags a key the projection has rows for that the copy does not', async () => {
    respond({
      app: [{ key: 'deed_receipts', n: 5 }],
      projection: [{ key: 'deed_receipts', n: 9 }],
    })
    const report = await checkStoreParity()
    expect(report.drifted[0]).toMatchObject({ key: 'deed_receipts', drift: 4 })
  })

  it('reports no drift before the projection tables exist (runbook step 2)', async () => {
    respond({ app: [{ key: 'deed_serials', n: 120 }], projectionExists: false })
    const report = await checkStoreParity()
    expect(report.projectionAvailable).toBe(false)
    expect(report.inParity).toBe(true)
  })

  it('treats a never-backfilled projection as not-yet-drift, not as total loss', async () => {
    // Projection table exists but the backfill (step 5) has not run: every key
    // legitimately reads 0 there. Reporting that as drift on every key would
    // make the alert useless noise before the cutover even starts.
    respond({ app: [{ key: 'deed_serials', n: 120 }, { key: 'deed_products', n: 80 }], projection: [] })
    const report = await checkStoreParity()
    expect(report.inParity).toBe(true)
    expect(report.rows).toEqual([])
  })
})

describe('store parity alerting', () => {
  it('publishes a critical alert naming the drifted keys', async () => {
    respond({ app: [{ key: 'deed_serials', n: 120 }], projection: [{ key: 'deed_serials', n: 118 }] })
    const result = await runStoreParityJob()
    expect(result.alerted).toBe(true)
    expect(mockPublish).toHaveBeenCalledTimes(1)
    const input = mockPublish.mock.calls[0][0]
    expect(input.eventType).toBe('store_parity_drift')
    expect(input.severity).toBe('critical')
    expect(input.body).toContain('deed_serials')
    expect(input.body).toContain('copy 120, Prisma 118')
  })

  it('does not alert while the layers agree', async () => {
    respond({ app: [{ key: 'deed_serials', n: 7 }], projection: [{ key: 'deed_serials', n: 7 }] })
    const result = await runStoreParityJob()
    expect(result.alerted).toBe(false)
    expect(mockPublish).not.toHaveBeenCalled()
  })

  it('keys idempotency on the actual counts so a standing gap alerts once but a growing one alerts again', async () => {
    respond({ app: [{ key: 'deed_serials', n: 120 }], projection: [{ key: 'deed_serials', n: 118 }] })
    await runStoreParityJob()
    respond({ app: [{ key: 'deed_serials', n: 120 }], projection: [{ key: 'deed_serials', n: 118 }] })
    await runStoreParityJob()
    const first = mockPublish.mock.calls[0][0].idempotencyKey
    const second = mockPublish.mock.calls[1][0].idempotencyKey
    expect(second).toBe(first)

    respond({ app: [{ key: 'deed_serials', n: 130 }], projection: [{ key: 'deed_serials', n: 118 }] })
    await runStoreParityJob()
    expect(mockPublish.mock.calls[2][0].idempotencyKey).not.toBe(first)
  })

  it('still reports the drift when the alert itself cannot be published', async () => {
    respond({ app: [{ key: 'deed_serials', n: 2 }], projection: [{ key: 'deed_serials', n: 1 }] })
    mockPublish.mockRejectedValueOnce(new Error('notification platform down'))
    const result = await runStoreParityJob()
    expect(result.inParity).toBe(false)
    expect(result.alerted).toBe(false)
  })
})
