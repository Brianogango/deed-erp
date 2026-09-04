import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

describe('shared 80x40 thermal label renderer', () => {
  const template = readFileSync('lib/inventory/thermal-label-template.ts', 'utf8')
  const serialSource = readFileSync('lib/inventory/serial-device-label.ts', 'utf8')
  const productSource = readFileSync('lib/product-label.ts', 'utf8')

  it('targets exact 80mm by 40mm label stock', () => {
    expect(template).toContain('@page { size: 80mm 40mm; margin: 0; }')
    expect(template).toContain('width: 80mm;')
    expect(template).toContain('height: 40mm;')
  })

  it('keeps the shared label minimal and high contrast', () => {
    expect(template).not.toContain('qrDataUrl')
    expect(template).not.toContain('IN STOCK')
    expect(template).not.toContain('WARRANTY')
    expect(template).not.toContain('CONDITION')
    expect(template).toContain("const INK = '#000000'")
    expect(template).toContain('lineColor: INK')
    expect(template).toContain('filter: grayscale(1) contrast(2)')
  })

  it('uses readable model and specification sizing', () => {
    expect(template).toContain('font-size: 11.5pt')
    expect(template).toContain('font-size: 8.8pt')
    expect(template).toContain('thermal-spec-key')
    expect(template).toContain('thermal-barcode-caption')
  })

  it('routes both serialized-device and generic product labels through the same renderer', () => {
    expect(serialSource).toContain("printThermalLabelBatch(labels, 'Serial Device Labels')")
    expect(productSource).toContain("printThermalLabelBatch(labels, 'Serial Labels')")
    expect(productSource).toContain('printThermalLabelBatch(Array.from({ length: count }, () => label)')
  })

  it('keeps serialized unit identity beneath the barcode instead of a separate serial block', () => {
    expect(serialSource).toContain('caption: view.serial || view.barcodeValue')
    expect(serialSource).not.toContain('SERIAL NUMBER')
    expect(productSource).not.toContain('Serial No.')
    expect(productSource).not.toContain('qrDataUrl')
  })
})
