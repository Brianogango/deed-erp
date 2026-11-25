import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { getColumnValue, reactNodeText, type ColumnDef } from '@/lib/data-table/types'
import { pdfEscape, pdfFit, pdfText } from '@/lib/export-utils-base'

type Row = { ref: string; vendorName: string; status: string }
const row: Row = { ref: 'OUT/0081', vendorName: 'Fastech', status: 'sent' }

describe('export values from columns with only render()', () => {
  it('reads the text out of rendered elements, never "[object Object]"', () => {
    const col: ColumnDef<Row> = { key: 'ref', label: 'Ref', priority: 1, render: r => createElement('span', { className: 'x' }, r.ref) }
    expect(getColumnValue(col, row, 'export')).toBe('OUT/0081')
  })
  it('joins nested children', () => {
    expect(reactNodeText(createElement('div', null, createElement('p', null, 'HP 840'), createElement('p', null, 'SN: 5CG')))).toBe('HP 840 SN: 5CG')
  })
  it('falls back to the field of the same name when a badge draws no text', () => {
    const Badge = (props: { status: string }) => createElement('i', null, props.status)
    const col: ColumnDef<Row> = { key: 'status', label: 'Status', priority: 1, render: r => createElement(Badge, { status: r.status }) }
    expect(getColumnValue(col, row, 'export')).toBe('sent')
    const col2: ColumnDef<Row> = { key: 'vendorName', label: 'Vendor', priority: 1, render: () => createElement('img', { alt: '' }) }
    expect(getColumnValue(col2, row, 'export')).toBe('Fastech')
  })
})

describe('PDF text', () => {
  it('keeps dashes, middle dots and quotes printable', () => {
    expect(pdfEscape(pdfText('Returned — fixed · 5 rows ’'))).toBe('Returned \\227 fixed \\267 5 rows \\222')
  })
  it('shortens before escaping, so a bracket escape is never cut in half', () => {
    const fitted = pdfFit(pdfText('Lenovo TP T480 (Victor Mwangi) REF'), 20)
    expect(fitted.endsWith('…')).toBe(true)
    const escaped = pdfEscape(fitted)
    expect(escaped.endsWith('\\')).toBe(false)
    expect(escaped).toContain('\\(')
  })
  it('drops characters the font cannot print', () => {
    expect(pdfText('Phone 📱 ready → collect')).toBe('Phone ready -> collect')
  })
})
