import { describe, expect, it } from 'vitest'
import {
  DOCUMENT_LAYOUT_IDS,
  DOCUMENT_LAYOUT_OPTIONS,
  normalizeDocumentBackground,
  normalizeDocumentFont,
  normalizeDocumentLayout,
  normalizeHexColor,
  normalizePaperFormat,
} from '@/lib/document-layout'
import { buildDeedDocumentPdf } from '@/lib/deed-document-pdf'

describe('Odoo document layout configuration', () => {
  it('exposes the layouts demonstrated by the Configure Document Layout wizard', () => {
    expect(DOCUMENT_LAYOUT_OPTIONS.map(option => option.id)).toEqual(DOCUMENT_LAYOUT_IDS)
    expect(DOCUMENT_LAYOUT_OPTIONS.map(option => option.label)).toEqual([
      'Standard',
      'Boxed',
      'Bold',
      'Striped',
      'Bubble',
      'Wave',
      'Folder',
    ])
  })

  it('normalizes legacy and invalid persisted configuration safely', () => {
    expect(normalizeDocumentLayout('classic')).toBe('standard')
    expect(normalizeDocumentLayout('light')).toBe('standard')
    expect(normalizeDocumentLayout('modern')).toBe('bold')
    expect(normalizeDocumentLayout('compact')).toBe('striped')
    expect(normalizeDocumentLayout('tampered')).toBe('standard')
    expect(normalizeDocumentFont('times')).toBe('times')
    expect(normalizeDocumentFont('invalid')).toBe('lato')
    expect(normalizeDocumentBackground('demo_logo')).toBe('demo_logo')
    expect(normalizeDocumentBackground('remote-url')).toBe('blank')
    expect(normalizePaperFormat('letter')).toBe('letter')
    expect(normalizePaperFormat('unknown')).toBe('a4')
    expect(normalizeHexColor('#123abc', '#714B67')).toBe('#123ABC')
    expect(normalizeHexColor('red', '#714B67')).toBe('#714B67')
  })

  it.each(DOCUMENT_LAYOUT_IDS)('renders a valid %s branded PDF', layout => {
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
        address: 'Sanlam House, Nairobi',
        currency: 'KES',
        printTemplate: layout,
        printFont: 'lato',
        printBackground: 'demo_logo',
        printPrimaryColor: '#714B67',
        printSecondaryColor: '#017E84',
        printTagline: 'Technology that works for you',
        printPaperFormat: 'a4',
      },
    )

    const prefix = String.fromCharCode(...new Uint8Array(doc.output('arraybuffer')).slice(0, 5))
    expect(prefix).toBe('%PDF-')
  })

  it.each(['a4', 'letter'] as const)('honours %s paper format', format => {
    const doc = buildDeedDocumentPdf(
      { title: 'Quotation', ref: 'QUO/2026/0001', customerName: 'Customer', lines: [] },
      { name: 'Deed Technologies LTD', printPaperFormat: format },
    )
    const expectedHeight = format === 'a4' ? 841.89 : 792
    expect(doc.internal.pageSize.getHeight()).toBeCloseTo(expectedHeight, 0)
  })
})
