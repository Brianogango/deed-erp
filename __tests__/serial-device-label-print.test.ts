import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

describe('80x40 serialized-device thermal label', () => {
  const source = readFileSync('lib/inventory/serial-device-label.ts', 'utf8')

  it('targets exact 80mm by 40mm label stock', () => {
    expect(source).toContain('@page { size: 80mm 40mm; margin: 0; }')
    expect(source).toContain('width: 80mm;')
    expect(source).toContain('height: 40mm;')
  })

  it('keeps the label minimal and removes low-value print clutter', () => {
    expect(source).not.toContain('qrDataUrl')
    expect(source).not.toContain('class="badge"')
    expect(source).not.toContain('class="meta-col"')
    expect(source).not.toContain('SERIAL NUMBER')
  })

  it('prints the important asset information at readable sizes', () => {
    expect(source).toContain('class="model"')
    expect(source).toContain('PROCESSOR')
    expect(source).toContain('RAM')
    expect(source).toContain('STORAGE')
    expect(source).toContain('font-size: 11.5pt')
    expect(source).toContain('font-size: 8.8pt')
  })

  it('prints the serial only beneath the barcode', () => {
    expect(source).toContain('<div class="barcode-caption">${esc(view.serial || view.barcodeValue)}</div>')
    expect(source).not.toContain('class="serial-num"')
  })

  it('uses black-only high-contrast thermal output', () => {
    expect(source).toContain("const INK = '#000000'")
    expect(source).toContain('lineColor: INK')
    expect(source).toContain('filter: grayscale(1) contrast(2)')
  })
})
