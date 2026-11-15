import { describe, expect, it } from 'vitest'
import { DOCUMENT_LAYOUT_IDS } from '@/lib/document-layout'
import { DOCUMENT_LAYOUT_SPECS, layoutSpec, layoutDensity } from '@/lib/document-layout-spec'
import { buildDeedDocumentPdf, type DeedPdfInput } from '@/lib/deed-document-pdf'

const input: DeedPdfInput = {
  title: 'Invoice', ref: 'INV/2026/0001', date: '2026-11-15', dueDate: '2026-11-30',
  customerName: 'Kenya Commercial Services Ltd', customerAddress: 'Upper Hill',
  lines: [
    { description: 'Dell Latitude 5440', qty: 2, unitPrice: 98500, taxRate: 16, subtotal: 197000, serial: 'DL-1' },
    { description: 'APC Back-UPS', qty: 4, unitPrice: 14500, taxRate: 16, discountPct: 5, subtotal: 55100 },
  ],
  subtotal: 252100, taxTotal: 40336, total: 292436, amountPaid: 100000,
  notes: 'Delivery within five working days.',
}

describe('document layouts', () => {
  it('gives every choice a spec', () => {
    for (const id of DOCUMENT_LAYOUT_IDS) expect(DOCUMENT_LAYOUT_SPECS[id]).toBeTruthy()
  })

  // The seven used to differ only in the ornament on the letterhead: picking a
  // template barely changed the document. Each must now differ from every other
  // in at least one structural choice, not just in colour.
  it('makes no two layouts the same document', () => {
    const seen = new Map<string, string>()
    for (const id of DOCUMENT_LAYOUT_IDS) {
      const s = layoutSpec(id)
      const shape = `${s.party}/${s.table}/${s.totals}/${s.density}`
      expect(seen.get(shape), `${id} is the same shape as ${seen.get(shape)}`).toBeUndefined()
      seen.set(shape, id)
    }
    expect(seen.size).toBe(DOCUMENT_LAYOUT_IDS.length)
  })

  it('covers every arrangement the engine can draw', () => {
    const specs = DOCUMENT_LAYOUT_IDS.map(layoutSpec)
    for (const party of ['split', 'card', 'mirrored', 'stacked']) {
      expect(specs.some(s => s.party === party), `no layout uses ${party}`).toBe(true)
    }
    for (const totals of ['column', 'card', 'band']) {
      expect(specs.some(s => s.totals === totals), `no layout uses ${totals}`).toBe(true)
    }
  })

  it('builds a one-page invoice in each of them', () => {
    for (const id of DOCUMENT_LAYOUT_IDS) {
      const doc = buildDeedDocumentPdf(input, { name: 'Deed Technologies', printTemplate: id }, [])
      expect(doc.getNumberOfPages(), `${id} spilled onto a second page`).toBe(1)
      expect(doc.output('arraybuffer').byteLength).toBeGreaterThan(2000)
    }
  })

  it('reads a density for every layout', () => {
    for (const id of DOCUMENT_LAYOUT_IDS) {
      const d = layoutDensity(id)
      expect(d.cellPadding).toBeGreaterThan(0)
      expect(d.fontSize).toBeGreaterThan(6)
    }
  })
})
