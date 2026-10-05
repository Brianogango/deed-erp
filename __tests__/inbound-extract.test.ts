import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({ parse: vi.fn(), requireRole: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@anthropic-ai/sdk', () => ({ default: class { messages = { parse: h.parse } } }))
vi.mock('@/lib/auth/api', () => ({
  withApiErrorHandling: async (fn: () => Promise<any>) => {
    try { return await fn() } catch (err: any) {
      return new Response(JSON.stringify({ error: err?.message }), { status: typeof err?.status === 'number' ? err.status : 500 })
    }
  },
  requireRole: h.requireRole,
}))

import { POST } from '@/app/api/inventory/inbound-import/extract/route'

const req = (body: unknown) => new Request('http://localhost/api/inventory/inbound-import/extract', { method: 'POST', body: JSON.stringify(body) })
const env = { ...process.env }

beforeEach(() => {
  vi.clearAllMocks()
  h.requireRole.mockResolvedValue({ id: 'u1', role: 'inventory_officer' })
  delete process.env.ANTHROPIC_API_KEY
  delete process.env.GEMINI_API_KEY
  delete process.env.GOOGLE_AI_API_KEY
})
afterEach(() => { process.env = { ...env } })

describe('POST /api/inventory/inbound-import/extract', () => {
  it('explains that PDFs need an AI key when none is configured', async () => {
    const res = await POST(req({ fileBase64: 'JVBERi0x', mimeType: 'application/pdf' }))
    expect(res.status).toBe(503)
    expect((await res.json()).error).toMatch(/Excel template/)
  })

  it('refuses other file types', async () => {
    expect((await POST(req({ fileBase64: 'abc', mimeType: 'text/html' }))).status).toBe(415)
  })

  it('turns the read document into import rows', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key'
    h.parse.mockResolvedValue({
      stop_reason: 'end_turn',
      parsed_output: {
        supplierName: 'Tech Supplies Ltd', documentReference: 'DN-4471', documentDate: '2026-10-03',
        lines: [
          { product: 'HP EliteBook 840 G8', sku: '', qty: 2, unitCost: 38000, serials: ['5cg1111aaa', ' 5CG1111AAB '] },
          { product: 'Delivery charge', sku: '', qty: 0, unitCost: 0, serials: [] },
        ],
      },
    })
    const res = await POST(req({ fileBase64: 'data:application/pdf;base64,JVBERi0x', mimeType: 'application/pdf' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ supplierName: 'Tech Supplies Ltd', documentReference: 'DN-4471' })
    expect(body.rows[0]).toEqual({ product: 'HP EliteBook 840 G8', qty: 2, unitCost: 38000, serials: ['5CG1111AAA', '5CG1111AAB'] })
    const call = h.parse.mock.calls[0][0]
    expect(call.messages[0].content[0]).toMatchObject({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'JVBERi0x' } })
  })

  it('reports an unreadable document instead of guessing', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key'
    h.parse.mockResolvedValue({ stop_reason: 'refusal', parsed_output: null })
    expect((await POST(req({ fileBase64: 'JVBERi0x', mimeType: 'application/pdf' }))).status).toBe(422)
  })
})
