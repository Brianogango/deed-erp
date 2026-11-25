import { describe, expect, it, vi, beforeEach } from 'vitest'

const mockClaim = vi.fn()
const mockComplete = vi.fn()
const mockFail = vi.fn()
const mockDequeue = vi.fn()
const mockRefresh = vi.fn()
const mockRunMirror = vi.fn()
const mockRunParity = vi.fn()
const mockRunInvoicePosting = vi.fn()
const mockPublish = vi.fn()

vi.mock('@/lib/infra/jobs', () => ({
  claimDurableJobs: (...a: unknown[]) => mockClaim(...a),
  completeDurableJob: (...a: unknown[]) => mockComplete(...a),
  failDurableJob: (...a: unknown[]) => mockFail(...a),
}))
vi.mock('@/lib/infra/queue', () => ({ dequeueJobs: (...a: unknown[]) => mockDequeue(...a) }))
vi.mock('@/lib/infra/report-snapshots', () => ({ refreshCoreReportSnapshots: (...a: unknown[]) => mockRefresh(...a) }))
vi.mock('@/lib/store-mirror-jobs', () => ({
  MIRROR_STORE_KEY_JOB: 'mirror_store_key',
  runMirrorStoreKeyJob: (...a: unknown[]) => mockRunMirror(...a),
}))
vi.mock('@/lib/store-parity', () => ({
  STORE_PARITY_JOB: 'store_parity_check',
  runStoreParityJob: (...a: unknown[]) => mockRunParity(...a),
}))
vi.mock('@/lib/invoice-posting-jobs', () => ({
  INVOICE_POSTING_JOB: 'retry_invoice_posting',
  runInvoicePostingRetry: (...a: unknown[]) => mockRunInvoicePosting(...a),
}))
vi.mock('@/lib/notifications/service', () => ({
  publishNotificationEvent: (...a: unknown[]) => mockPublish(...a),
}))

import { runInfraWorker } from '@/lib/infra/worker'

function job(over: Record<string, unknown> = {}) {
  return { id: 'j1', type: 'mirror_store_key', queue: 'mirrors', payload: { key: 'deed_deliveries' }, status: 'running', uniqueKey: null, attempts: 1, maxAttempts: 6, ...over }
}

beforeEach(() => {
  for (const m of [mockClaim, mockComplete, mockFail, mockDequeue, mockRefresh, mockRunMirror, mockRunParity, mockRunInvoicePosting, mockPublish]) m.mockReset()
  mockDequeue.mockResolvedValue([])
  mockComplete.mockResolvedValue({})
  mockPublish.mockResolvedValue({ id: 'evt' })
  mockRunMirror.mockResolvedValue({ key: 'deed_deliveries', mirrored: 2 })
})

describe('infra worker job dispatch', () => {
  it('routes a mirror job to the mirror runner and completes it', async () => {
    mockClaim.mockResolvedValue([job()])
    const result = await runInfraWorker()
    expect(mockRunMirror).toHaveBeenCalledWith({ key: 'deed_deliveries' })
    expect(mockComplete).toHaveBeenCalledWith('j1')
    expect(result).toMatchObject({ processed: 1, succeeded: 1, failed: 0 })
  })

  it('routes a parity job and an invoice posting retry', async () => {
    mockClaim.mockResolvedValue([
      job({ id: 'j2', type: 'store_parity_check', payload: {} }),
      job({ id: 'j3', type: 'retry_invoice_posting', payload: { invoiceId: 'inv' } }),
    ])
    mockRunParity.mockResolvedValue({ inParity: true })
    mockRunInvoicePosting.mockResolvedValue({ outcome: 'posted' })
    const result = await runInfraWorker()
    expect(mockRunParity).toHaveBeenCalled()
    expect(mockRunInvoicePosting).toHaveBeenCalledWith({ invoiceId: 'inv' })
    expect(result.succeeded).toBe(2)
  })

  it('schedules another attempt when a mirror job fails but has retries left', async () => {
    mockClaim.mockResolvedValue([job({ attempts: 2, maxAttempts: 6 })])
    mockRunMirror.mockRejectedValueOnce(new Error('still down'))
    mockFail.mockResolvedValue({ status: 'retrying' })
    const result = await runInfraWorker()
    expect(mockFail).toHaveBeenCalledWith('j1', 'still down', { attempts: 2, maxAttempts: 6 })
    expect(mockPublish).not.toHaveBeenCalled()
    expect(result.failed).toBe(1)
  })

  it('alerts once a mirror job has exhausted every retry', async () => {
    mockClaim.mockResolvedValue([job({ attempts: 6, maxAttempts: 6 })])
    mockRunMirror.mockRejectedValueOnce(new Error('table cannot hold these rows'))
    mockFail.mockResolvedValue({ status: 'failed' })
    await runInfraWorker()
    expect(mockPublish).toHaveBeenCalledTimes(1)
    const input = mockPublish.mock.calls[0][0]
    expect(input.eventType).toBe('store_mirror_exhausted')
    expect(input.severity).toBe('critical')
    expect(input.title).toContain('deed_deliveries')
    expect(input.idempotencyKey).toBe('store-mirror-exhausted:deed_deliveries')
  })

  it('does not alert when a non-mirror job exhausts its retries', async () => {
    mockClaim.mockResolvedValue([job({ type: 'refresh_core_reports' })])
    mockRefresh.mockRejectedValueOnce(new Error('snapshot failed'))
    mockFail.mockResolvedValue({ status: 'failed' })
    await runInfraWorker()
    expect(mockPublish).not.toHaveBeenCalled()
  })

  it('a failing alert does not break the worker run', async () => {
    mockClaim.mockResolvedValue([job({ attempts: 6, maxAttempts: 6 })])
    mockRunMirror.mockRejectedValueOnce(new Error('boom'))
    mockFail.mockResolvedValue({ status: 'failed' })
    mockPublish.mockRejectedValueOnce(new Error('notifications down'))
    await expect(runInfraWorker()).resolves.toMatchObject({ failed: 1 })
  })

  it('still rejects an unknown job type', async () => {
    mockClaim.mockResolvedValue([job({ type: 'not_a_real_job' })])
    mockFail.mockResolvedValue({ status: 'retrying' })
    await runInfraWorker()
    expect(mockFail.mock.calls[0][1]).toMatch(/Unknown background job type/)
  })
})
