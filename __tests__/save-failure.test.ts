import { afterEach, describe, expect, it, vi } from 'vitest'
import { SAVE_FAILED_EVENT, describeSaveFailure, documentNameForUrl, reportingFetch } from '@/lib/save-failure'

describe('telling people a background save was refused', () => {
  it('names the document', () => {
    expect(documentNameForUrl('/api/sale-orders/abc')).toBe('sale order')
    expect(documentNameForUrl('/api/purchase-orders/abc?x=1')).toBe('purchase order')
    expect(documentNameForUrl('/api/unknown')).toBe('change')
  })

  it('gives the server reason when there is one, a plain one otherwise', () => {
    expect(describeSaveFailure('/api/invoices/1', 'PATCH', 409, 'Posted invoices are immutable.'))
      .toContain('Could not update the invoice: Posted invoices are immutable.')
    expect(describeSaveFailure('/api/sale-orders/1', 'PATCH', 403)).toContain('you are not allowed to do this')
    expect(describeSaveFailure('/api/deliveries', 'POST', null)).toContain('Could not create the delivery: the server could not be reached')
  })
})

describe('reportingFetch', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('announces a refused save and still returns the response', async () => {
    const events: string[] = []
    const target = new EventTarget()
    vi.stubGlobal('window', Object.assign(target, { dispatchEvent: (e: Event) => { events.push((e as CustomEvent).detail.message); return true } }))
    vi.stubGlobal('CustomEvent', class extends Event { detail: unknown; constructor(type: string, init?: { detail?: unknown }) { super(type); this.detail = init?.detail } })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Sent quotations are locked.' }), { status: 409 })))
    const res = await reportingFetch('/api/sale-orders/so-1', { method: 'PATCH' })
    expect((res as Response).status).toBe(409)
    expect(events).toEqual([expect.stringContaining('Could not update the sale order: Sent quotations are locked.')])
    expect(SAVE_FAILED_EVENT).toBe('deed:save-failed')
  })

  it('stays quiet when the save succeeds', async () => {
    const events: unknown[] = []
    vi.stubGlobal('window', { dispatchEvent: (e: Event) => { events.push(e); return true } })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })))
    await reportingFetch('/api/invoices/1', { method: 'PUT' })
    expect(events).toEqual([])
  })
})
