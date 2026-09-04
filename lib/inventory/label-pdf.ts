/**
 * Bulk label PDF helpers.
 * PDF exports use the same 80×40mm black-and-white visual system as direct
 * thermal printing so Product Master, GRN and Warehouse labels stay consistent.
 */

import { productThermalSpecs } from '@/lib/product-label'
import { catalogBaseName } from '@/lib/reconfiguration/unit-selling-name'
import type { ThermalLabelSpec } from '@/lib/inventory/thermal-label-template'

export type ProductLabelPdfItem = {
  name: string
  sku: string
  barcode?: string
  salePrice?: number
  category?: string
  productType?: string
  specs?: string
}

export type SerialLabelPdfItem = {
  serial: string
  barcode?: string
  productName: string
  sku: string
  category?: string
  productType?: string
  specs?: string
}

type JsPdfDoc = import('jspdf').jsPDF

type PdfThermalLabel = {
  title: string
  barcodeValue: string
  caption: string
  specs: ThermalLabelSpec[]
}

function clean(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function titleForLabel(value: string): string {
  return clean(catalogBaseName(value) || value || 'PRODUCT').toUpperCase()
}

function stampFilename(prefix: string) {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${prefix}-${yyyy}-${mm}-${dd}.pdf`
}

function barcodeDataUrl(value: string): string {
  if (typeof window === 'undefined' || !value.trim()) return ''
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const JsBarcode = require('jsbarcode')
    const canvas = document.createElement('canvas')
    JsBarcode(canvas, value, {
      format: 'CODE128',
      width: 2.2,
      height: 52,
      displayValue: false,
      margin: 0,
      background: '#FFFFFF',
      lineColor: '#000000',
    })
    return canvas.toDataURL('image/png')
  } catch {
    return ''
  }
}

async function imageDataUrl(src: string): Promise<string | null> {
  if (typeof window === 'undefined') return null
  try {
    const res = await fetch(src)
    if (!res.ok) return null
    const blob = await res.blob()
    return await new Promise(resolve => {
      const reader = new FileReader()
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null)
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

function drawSpecColumn(
  doc: JsPdfDoc,
  spec: ThermalLabelSpec,
  x: number,
  width: number,
  primary = false,
) {
  doc.setTextColor(0, 0, 0)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(5.8)
  doc.text(clean(spec.label).toUpperCase(), x, 13.4)

  doc.setFontSize(primary ? 8.3 : 8.8)
  const value = clean(spec.value) || '—'
  const lines = doc.splitTextToSize(value, Math.max(5, width - 1))
  doc.text(lines.slice(0, 2), x, 17.6)
}

function drawThermalLabel(doc: JsPdfDoc, item: PdfThermalLabel, logoData: string | null) {
  doc.setFillColor(255, 255, 255)
  doc.rect(0, 0, 80, 40, 'F')
  doc.setDrawColor(0, 0, 0)
  doc.setTextColor(0, 0, 0)

  if (logoData) {
    doc.addImage(logoData, 'PNG', 2.2, 2.0, 11.5, 6.3, undefined, 'FAST')
  } else {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.text('deed', 2.2, 5.4)
    doc.setFontSize(3.8)
    doc.text('TECHNOLOGIES LTD', 2.2, 7.3)
  }

  doc.setLineWidth(0.35)
  doc.line(15.2, 1.7, 15.2, 9.5)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11.5)
  const titleLines = doc.splitTextToSize(item.title, 60.5)
  doc.text(titleLines.slice(0, 2), 17.1, 4.5)

  doc.setLineWidth(0.35)
  doc.line(2.2, 10.3, 77.8, 10.3)

  const specs = item.specs.length ? item.specs.slice(0, 3) : [{ label: 'Specification', value: '—' }]
  if (specs.length === 1) {
    drawSpecColumn(doc, specs[0], 2.2, 75.6, true)
  } else if (specs.length === 2) {
    drawSpecColumn(doc, specs[0], 2.2, 36.5, true)
    doc.setLineWidth(0.25)
    doc.line(39.5, 11.5, 39.5, 20.2)
    drawSpecColumn(doc, specs[1], 41.2, 36.6)
  } else {
    drawSpecColumn(doc, specs[0], 2.2, 34.5, true)
    doc.setLineWidth(0.25)
    doc.line(37.5, 11.5, 37.5, 20.2)
    drawSpecColumn(doc, specs[1], 39.2, 15.0)
    doc.line(55.0, 11.5, 55.0, 20.2)
    drawSpecColumn(doc, specs[2], 56.7, 21.1)
  }

  doc.setLineWidth(0.35)
  doc.line(2.2, 21.4, 77.8, 21.4)

  const barcode = barcodeDataUrl(item.barcodeValue)
  if (barcode) {
    doc.addImage(barcode, 'PNG', 4.0, 23.3, 72.0, 8.0, undefined, 'FAST')
  } else {
    doc.setLineWidth(0.3)
    doc.rect(4.0, 23.3, 72.0, 8.0)
    doc.setFontSize(7)
    doc.setFont('helvetica', 'bold')
    doc.text(item.barcodeValue, 40, 28.4, { align: 'center' })
  }

  doc.setTextColor(0, 0, 0)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.text(item.caption, 40, 34.8, { align: 'center' })
}

async function saveThermalLabelsPdf(
  labels: PdfThermalLabel[],
  filename: string,
): Promise<string> {
  if (!labels.length) throw new Error('No labels selected')

  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [80, 40] })
  const logoData = await imageDataUrl('/deed-logo-receipt.png')

  labels.forEach((label, index) => {
    if (index > 0) doc.addPage([80, 40], 'landscape')
    drawThermalLabel(doc, label, logoData)
  })

  doc.save(filename)
  return filename
}

export async function downloadProductLabelsPdf(
  items: ProductLabelPdfItem[],
  opts?: { filename?: string; companyName?: string },
): Promise<string> {
  if (!items.length) throw new Error('No products selected')

  const labels = items.map(item => {
    const barcodeValue = clean(item.barcode) || clean(item.sku)
    return {
      title: titleForLabel(item.name),
      barcodeValue,
      caption: clean(item.sku) || barcodeValue,
      specs: productThermalSpecs({
        name: item.name,
        category: item.category,
        specsText: item.specs,
      }),
    }
  }).filter(label => label.barcodeValue)

  return saveThermalLabelsPdf(labels, opts?.filename || stampFilename('product-labels-80x40'))
}

export async function downloadSerialLabelsPdf(
  items: SerialLabelPdfItem[],
  opts?: { filename?: string; companyName?: string },
): Promise<string> {
  if (!items.length) throw new Error('No serials selected')

  const labels = items.map(item => {
    const barcodeValue = clean(item.serial) || clean(item.barcode) || clean(item.sku)
    return {
      title: titleForLabel(item.productName),
      barcodeValue,
      caption: clean(item.serial) || barcodeValue,
      specs: productThermalSpecs({
        name: item.productName,
        category: item.category,
        specsText: item.specs,
      }),
    }
  }).filter(label => label.barcodeValue)

  return saveThermalLabelsPdf(labels, opts?.filename || stampFilename('inventory-serial-labels-80x40'))
}
