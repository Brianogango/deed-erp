import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fp, findMany } = vi.hoisted(() => ({ fp: { value: 'a' }, findMany: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  default: {
    $queryRawUnsafe: vi.fn(async () => [{ fp: fp.value }]),
    quote: { findMany },
  },
}))

import { loadScreenQuotes } from '@/lib/sales-read-model.server'
import { clearReadModelCache } from '@/lib/read-model-cache'

describe('quote list cache', () => {
  beforeEach(() => { clearReadModelCache(); findMany.mockReset(); findMany.mockResolvedValue([]); fp.value = 'a' })

  it('reads the tables once while nothing changes, again when quotes change', async () => {
    await loadScreenQuotes([])
    await loadScreenQuotes([])
    expect(findMany).toHaveBeenCalledTimes(1)
    fp.value = 'b'
    await loadScreenQuotes([])
    expect(findMany).toHaveBeenCalledTimes(2)
  })
})
