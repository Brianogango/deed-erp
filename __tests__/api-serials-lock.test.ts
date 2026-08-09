import { describe, expect, it, vi } from 'vitest'

const { mockMakeCollectionHandlers } = vi.hoisted(() => ({
  mockMakeCollectionHandlers: vi.fn(() => ({ GET: vi.fn(), POST: vi.fn() })),
}))

vi.mock('@/lib/server-store-crud', () => ({
  makeCollectionHandlers: mockMakeCollectionHandlers,
}))

describe('POST /api/serials lock configuration', () => {
  it('opts into the deed_serials advisory lock (closes the GRN-vs-manual-intake race)', async () => {
    await import('@/app/api/serials/route')
    expect(mockMakeCollectionHandlers).toHaveBeenCalledWith(
      expect.objectContaining({ storeKey: 'deed_serials', lockKey: 'deed_serials' }),
    )
  })
})
