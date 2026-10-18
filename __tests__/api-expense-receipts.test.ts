import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSession, mockLoad, mockSave } = vi.hoisted(() => ({
  mockSession: vi.fn(),
  mockLoad: vi.fn(),
  mockSave: vi.fn(),
}))
vi.mock('@/lib/auth/server', () => ({ getServerSession: mockSession }))
vi.mock('@/lib/server-store', () => ({ loadAppState: mockLoad, saveStoreKeys: mockSave }))

import { DELETE, POST } from '@/app/api/expense-receipts/[expenseId]/route'

const PNG = 'data:image/png;base64,iVBORw0KGgo='
const params = { params: Promise.resolve({ expenseId: 'exp-1' }) }
const post = (dataUrl: string) => POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ dataUrl }) }) as any, params)

describe('expense receipts', () => {
  beforeEach(() => {
    mockSession.mockResolvedValue({ user: { id: 'u1', role: 'technician' } })
    mockLoad.mockResolvedValue({})
    mockSave.mockReset()
  })

  it('stores a receipt for a claim that has none', async () => {
    expect((await post(PNG)).status).toBe(200)
    expect(mockSave).toHaveBeenCalledWith({ 'expense_receipt_exp-1': PNG })
  })

  it('never replaces a stored receipt', async () => {
    mockLoad.mockResolvedValue({ 'expense_receipt_exp-1': PNG })
    expect((await post(PNG)).status).toBe(409)
    expect(mockSave).not.toHaveBeenCalled()
  })

  it('refuses something that is not a file', async () => {
    expect((await post('not a data url')).status).toBe(415)
  })

  it('only Finance or a Director can remove a receipt', async () => {
    expect((await DELETE(new Request('http://x') as any, params)).status).toBe(403)
    mockSession.mockResolvedValue({ user: { id: 'u2', role: 'finance_officer' } })
    expect((await DELETE(new Request('http://x') as any, params)).status).toBe(200)
  })
})
