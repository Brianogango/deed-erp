import { describe, expect, it } from 'vitest'
import {
  DOCUMENT_LAYOUT_IDS,
  DOCUMENT_LAYOUT_OPTIONS,
  normalizeDocumentLayout,
} from '@/lib/document-layout'
import { buildDeedDocumentPdf } from '@/lib/deed-document-pdf'

describe('document layouts', () => {
  it('exposes all Odoo 18 layout choices in a stable order', () => {
    expect(DOCUMENT_LAYOUT_OPTIONS.map(option => option.id)).toEqual(DOCUMENT_LAYOUT_IDS)
    expect(DOCUMENT_LAYOUT_OPTIONS.map(option => option.label)).toEqual([
      'Light',
      'Boxed',
      'Bold',
      'Striped',
      'Bubble',
      'Wave',
    ])
  })

  it('maps legacy settings and rejects unknown persisted values safely', () => {
    expect(normalizeDocumentLayout('classic')).toBe('light')
    expect(normalizeDocumentLayout('modern')).toBe('bold')
    expect(normalizeDocumentLayout('compact')).toBe('striped')
    expect(normalizeDocumentLayout('tampered')).toBe('light')
    expect(normalizeDocumentLayout(undefined)).toBe('light')
  })

  it.each(DOCUMENT_LAYOUT_IDS)('renders a valid %s commercial PDF', layout => {
    const doc = buildDeedDocumentPdf(
      {
        title: 'Invoice',
        ref: 'INV/2026/0001',
        date: '2026-09-13',
        customerName: 'Test Customer',
        lines: [{ description: 'Managed IT support', qty: 1, unitPrice: 1000, taxRate: 16, subtotal: 1000 }],
        subtotal: 1000,
        taxTotal: 160,
        total: 1160,
      },
      {
        name: 'Deed Technologies LTD',
        currency: 'KES',
        printTemplate: layout,
      },
    )

    const prefix = String.fromCharCode(...new Uint8Array(doc.output('arraybuffer')).slice(0, 5))
    expect(prefix).toBe('%PDF-')
  })
})
