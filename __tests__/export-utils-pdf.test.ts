import { afterEach, describe, expect, it, vi } from 'vitest'
import { exportToPDF } from '@/lib/export-utils'

describe('exportToPDF', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('writes multiple pages when rows overflow a single landscape sheet', () => {
    const clicks: Array<{ download: string; type: string; size: number }> = []
    const createObjectURL = vi.fn((blob: Blob) => {
      clicks.push({ download: '', type: blob.type, size: blob.size })
      return 'blob:mock'
    })
    const revokeObjectURL = vi.fn()
    const appendChild = vi.fn()
    const removeChild = vi.fn()
    const click = vi.fn(function (this: HTMLAnchorElement) {
      clicks[clicks.length - 1].download = this.download
    })

    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
    vi.stubGlobal('document', {
      createElement: () => ({ click, href: '', download: '' }),
      body: { appendChild, removeChild },
    })

    const rows = Array.from({ length: 80 }, (_, i) => [
      `Product ${String(i + 1).padStart(3, '0')}`,
      'Laptops',
      1,
      1000,
      1500,
      33.3,
    ])

    exportToPDF(
      'Inventory Report',
      ['Product', 'Category', 'Available', 'Cost', 'Sale price', 'Margin'],
      rows,
      'inventory-catalog',
    )

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    const blob = createObjectURL.mock.calls[0][0] as Blob
    expect(blob.type).toBe('application/pdf')

    return blob.text().then(text => {
      // Generic operational exports still paginate rather than dropping overflow rows.
      expect(text).toMatch(/\/Count\s+[2-9]\d*/)
      expect(text).toContain('Page 1 of')
      expect(text).toContain('80 rows')
      expect(clicks[0].download).toBe('inventory-catalog.pdf')
    })
  })
})
