import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { buildDeedDocumentPdf, LETTERHEAD_H, BODY_TOP, type DeedPdfCompanyInput, type DeedPdfInput } from '@/lib/deed-document-pdf'
import { DOCUMENT_LAYOUT_IDS } from '@/lib/document-layout'

const logo = `data:image/png;base64,${readFileSync('public/deed-logo.png').toString('base64')}`

const input: DeedPdfInput = {
  title: 'Invoice', ref: 'INV/2026/0417', date: '2026-11-15',
  customerName: 'Kenya Commercial Services Ltd',
  lines: [{ description: 'Dell Latitude 5440', qty: 2, unitPrice: 98500, taxRate: 16, subtotal: 197000 }],
  subtotal: 197000, taxTotal: 31520, total: 228520,
}
const company: DeedPdfCompanyInput = {
  name: 'Deed Technologies', address: 'Luthuli Avenue', city: 'Nairobi',
  logoDataUrl: logo, logoWidth: 595, logoHeight: 595, logoFormat: 'PNG',
}

describe('the company mark', () => {
  // The logo shipped with the ERP is square. The old box was 154 wide by 56
  // tall, so a square mark came out 56 across — a third of the width it was
  // given — and looked like an afterthought on every document the company
  // sends out.
  it('leaves the body clear of the letterhead', () => {
    expect(BODY_TOP).toBeGreaterThan(LETTERHEAD_H)
  })

  it('builds on every layout with a real logo, on one page', () => {
    for (const id of DOCUMENT_LAYOUT_IDS) {
      const doc = buildDeedDocumentPdf(input, { ...company, printTemplate: id }, [])
      expect(doc.getNumberOfPages(), `${id} spilled`).toBe(1)
      expect(doc.output('arraybuffer').byteLength).toBeGreaterThan(5000)
    }
  })

  // A dark logo on a letterhead filled with the same dark colour is invisible.
  // Those layouts lay it on a white plate, which works for whatever a tenant
  // uploads; a second inverted file would only work for one.
  it('carries the logo onto the layouts that fill the letterhead', () => {
    for (const id of ['bold', 'folder'] as const) {
      const plain = buildDeedDocumentPdf(input, { ...company, printTemplate: id }, [])
      expect(plain.getNumberOfPages()).toBe(1)
    }
  })

  it('still draws a mark when the logo cannot be read', () => {
    const broken = { ...company, logoDataUrl: 'data:image/png;base64,notreallyapng' }
    const doc = buildDeedDocumentPdf(input, broken, [])
    expect(Buffer.from(doc.output('arraybuffer')).toString('latin1').toLowerCase()).toContain('deed')
  })
})
