import { describe, expect, it, vi, beforeEach } from 'vitest'

const printThermalLabelBatch = vi.fn()
vi.mock('@/lib/inventory/thermal-label-template', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/inventory/thermal-label-template')>()),
  printThermalLabelBatch: (...args: unknown[]) => printThermalLabelBatch(...args),
}))

import { printProductLabelsBatch } from '@/lib/product-label'

const product = (o: Record<string, unknown>) => ({ id: 'p', name: 'USB Mouse', category: 'Accessories', ...o }) as never

describe('printing labels for several products', () => {
  beforeEach(() => printThermalLabelBatch.mockClear())

  it('sends every product, with its own count, to the printer as one job', () => {
    const result = printProductLabelsBatch([
      { product: product({ id: 'a', name: 'USB Mouse', sku: 'MOU-1' }), qty: 3 },
      { product: product({ id: 'b', name: 'HDMI Cable', barcode: '6001234' }), qty: 2 },
      { product: product({ id: 'c', name: 'Laptop Bag', sku: 'BAG-1' }), qty: 0 },
    ])
    expect(printThermalLabelBatch).toHaveBeenCalledTimes(1)
    const labels = printThermalLabelBatch.mock.calls[0][0] as Array<{ barcodeValue: string }>
    expect(labels.map(l => l.barcodeValue)).toEqual(['MOU-1', 'MOU-1', 'MOU-1', '6001234', '6001234'])
    expect(result).toEqual({ printed: 5, skipped: [] })
  })

  it('reports products it cannot print instead of failing the whole job', () => {
    const noCode = product({ id: 'x', name: 'Unlabelled' })
    const result = printProductLabelsBatch([
      { product: noCode, qty: 2 },
      { product: product({ sku: 'MOU-1' }), qty: 1 },
    ])
    expect(result.printed).toBe(1)
    expect(result.skipped).toEqual([noCode])
    expect(printThermalLabelBatch).toHaveBeenCalledTimes(1)
  })

  it('opens no print window when nothing is printable', () => {
    expect(printProductLabelsBatch([{ product: product({}), qty: 4 }]).printed).toBe(0)
    expect(printThermalLabelBatch).not.toHaveBeenCalled()
  })
})
