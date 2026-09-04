'use client'

import type { ExportRow } from '@/lib/export-utils-base'
import { getStoredCompanyData } from '@/lib/company'
import { productThumbSource } from '@/lib/product-images'
import { parseSpecsString } from '@/lib/reconfiguration/display-name'
import { catalogBaseName, formatStorageGb } from '@/lib/reconfiguration/unit-selling-name'
import { loadXlsx } from '@/lib/xlsx-lazy'

export type ClientCatalogRow = {
  key: string
  model: string
  specs: string
  qty: number
  priceMin: number
  priceMax: number
  priceLabel: string
  imageUrl: string | null
}

const NAVY: [number, number, number] = [16, 47, 103]
const BLUE: [number, number, number] = [10, 103, 178]
const CYAN: [number, number, number] = [0, 174, 239]
const INK: [number, number, number] = [18, 33, 61]
const MUTED: [number, number, number] = [93, 109, 132]
const BORDER: [number, number, number] = [214, 227, 239]
const PALE_BLUE: [number, number, number] = [239, 247, 253]

function clean(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function money(value: number): string {
  return Math.max(0, Number(value) || 0).toLocaleString('en-KE', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
}

function normaliseHeader(value: string): string {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function columnIndex(headers: string[], ...names: string[]): number {
  const wanted = new Set(names.map(normaliseHeader))
  return headers.findIndex(header => wanted.has(normaliseHeader(header)))
}

function numberValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const parsed = Number(String(value ?? '').replace(/[^0-9.-]+/g, ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function absoluteUrl(value: string | null): string | null {
  if (!value) return null
  if (/^https?:\/\//i.test(value) || value.startsWith('data:image/')) return value
  if (typeof window === 'undefined') return value
  return `${window.location.origin}${value.startsWith('/') ? value : `/${value}`}`
}

function screenLabel(text: string): string {
  const size = text.match(/\b(\d{1,2}(?:\.\d+)?)\s*(?:["”]|inch(?:es)?\b)/i)?.[1]
  const resolution = text.match(/\b(WUXGA|FHD|QHD\+?|UHD|HD\+?|2K|4K)\b/i)?.[1]?.toUpperCase()
  const touch = /\b(touch|touchscreen)\b/i.test(text)
  return [size ? `${size}\"` : '', resolution || '', touch ? 'Touch' : ''].filter(Boolean).join(' ')
}

function osLabel(text: string): string {
  const match = text.match(/\b(Windows\s*11\s*(?:Pro|Home)?|Windows\s*10\s*(?:Pro|Home)?|FreeDOS|Chrome\s*OS|ChromeOS|macOS)\b/i)
  return match ? clean(match[1]) : ''
}

function processorLabel(parsed: ReturnType<typeof parseSpecsString>): string {
  const processor = clean(parsed.processor)
  const generation = clean(parsed.processorGeneration)
  if (!processor && !generation) return ''
  if (processor && generation && processor.toLowerCase().includes(generation.toLowerCase())) return processor
  return [generation, processor].filter(Boolean).join(' ')
}

function specsFromName(name: string): string {
  const parsed = parseSpecsString(name)
  const parts: string[] = []
  const cpu = processorLabel(parsed)
  if (cpu) parts.push(cpu)
  if (Number(parsed.totalRamGb) > 0) parts.push(`${Math.round(Number(parsed.totalRamGb))}GB RAM`)
  if (Number(parsed.primaryStorageGb) > 0) {
    parts.push(formatStorageGb(Math.round(Number(parsed.primaryStorageGb)), parsed.storageType))
  }
  const screen = screenLabel(name)
  if (screen) parts.push(screen)
  const os = osLabel(name)
  if (os) parts.push(os)
  return parts.length ? parts.join(' | ') : 'Standard configuration'
}

function modelFromName(name: string): string {
  const parsed = parseSpecsString(name)
  let model = catalogBaseName(name) || clean(name)
  const remove = [clean(parsed.processorGeneration), clean(parsed.processor)]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
  for (const token of remove) {
    model = model.replace(new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), ' ')
  }
  model = model
    .replace(/\b(?:Windows\s*(?:10|11)\s*(?:Pro|Home)?|FreeDOS|Chrome\s*OS|ChromeOS|macOS)\b/ig, ' ')
    .replace(/\b\d{1,2}(?:\.\d+)?\s*(?:["”]|inch(?:es)?\b)/ig, ' ')
    .replace(/\b(?:WUXGA|FHD|QHD\+?|UHD|HD\+?|2K|4K)\b/ig, ' ')
    .replace(/\s*[-,/|]+\s*$/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
  return model || clean(name)
}

function groupKey(model: string, specs: string): string {
  const normalise = (value: string) => clean(value)
    .toLowerCase()
    .replace(/nvme\s+ssd/g, 'nvme')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
  return `${normalise(model)}::${normalise(specs)}`
}

function photoForName(name: string): string | null {
  const source = productThumbSource({ name })
  if (!source || source.speculative) return null
  return absoluteUrl(source.src)
}

/**
 * Converts the current operational Product Catalog table into the external-facing
 * catalog contract. Internal cost, margin, condition, category and update fields
 * are intentionally ignored even when present in the source table.
 */
export function buildClientCatalogRowsFromTable(headers: string[], rows: ExportRow[]): ClientCatalogRow[] {
  const productIndex = columnIndex(headers, 'Product', 'Product details', 'Model', 'Model / Series')
  const qtyIndex = columnIndex(headers, 'Available', 'Qty', 'Qty Available', 'Quantity')
  const priceIndex = columnIndex(headers, 'Sale price', 'Selling Price', 'Selling Price (KES)', 'Price')
  if (productIndex < 0 || qtyIndex < 0 || priceIndex < 0) return []

  const grouped = new Map<string, ClientCatalogRow>()
  for (const source of rows) {
    const name = clean(source[productIndex])
    const qty = Math.max(0, Math.floor(numberValue(source[qtyIndex])))
    if (!name || qty <= 0) continue
    const price = Math.max(0, numberValue(source[priceIndex]))
    const model = modelFromName(name)
    const specs = specsFromName(name)
    const key = groupKey(model, specs)
    const existing = grouped.get(key)

    if (!existing) {
      grouped.set(key, {
        key,
        model,
        specs,
        qty,
        priceMin: price,
        priceMax: price,
        priceLabel: `KES ${money(price)}`,
        imageUrl: photoForName(name),
      })
      continue
    }

    existing.qty += qty
    existing.priceMin = Math.min(existing.priceMin, price)
    existing.priceMax = Math.max(existing.priceMax, price)
    existing.priceLabel = existing.priceMin === existing.priceMax
      ? `KES ${money(existing.priceMin)}`
      : `KES ${money(existing.priceMin)} – ${money(existing.priceMax)}`
    if (!existing.imageUrl) existing.imageUrl = photoForName(name)
  }

  return Array.from(grouped.values()).sort((a, b) =>
    a.model.localeCompare(b.model, 'en', { numeric: true, sensitivity: 'base' }),
  )
}

function company() {
  const value = getStoredCompanyData()
  return {
    name: value.name || 'Deed Technologies LTD',
    website: clean(value.website).replace(/^https?:\/\//i, '').replace(/\/$/, '') || 'deed.africa',
    email: value.email || 'info@deed.africa',
    phone: value.phone || '',
    logoUrl: value.logoUrl || '/deed-logo-receipt.png',
  }
}

function imageFormat(dataUrl: string): 'PNG' | 'JPEG' {
  return /^data:image\/jpe?g/i.test(dataUrl) ? 'JPEG' : 'PNG'
}

async function fetchDataUrl(url: string | null): Promise<string | null> {
  if (!url) return null
  if (url.startsWith('data:image/')) return url
  try {
    const response = await fetch(url, { credentials: 'include' })
    if (!response.ok) return null
    const blob = await response.blob()
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

export async function exportClientCatalogPdfFromTable(
  headers: string[],
  sourceRows: ExportRow[],
  filename: string,
): Promise<void> {
  const rows = buildClientCatalogRowsFromTable(headers, sourceRows)
  const co = company()
  const [{ jsPDF }, autoTableModule] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const autoTable = autoTableModule.default
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const margin = 10
  const logo = await fetchDataUrl(absoluteUrl(co.logoUrl))
  const images = new Map<string, string | null>()
  await Promise.all(rows.map(async row => {
    if (!row.imageUrl || images.has(row.imageUrl)) return
    images.set(row.imageUrl, await fetchDataUrl(row.imageUrl))
  }))

  const drawFrame = (pageNumber: number) => {
    if (logo) {
      try { doc.addImage(logo, imageFormat(logo), margin, 7, 36, 13, undefined, 'FAST') } catch { /* fallback below */ }
    } else {
      doc.setFont('helvetica', 'bold').setFontSize(20).setTextColor(...NAVY)
      doc.text('deed', margin, 17)
      doc.setFontSize(6).setTextColor(...BLUE)
      doc.text('TECHNOLOGIES LTD', margin + 1, 21)
    }

    doc.setFont('helvetica', 'bold').setFontSize(17).setTextColor(...NAVY)
    doc.text('PRODUCT CATALOG', pageW / 2, 13.5, { align: 'center' })
    doc.setFont('helvetica', 'normal').setFontSize(7.2).setTextColor(...MUTED)
    doc.text('Reliable Devices for Work, Learning and Everyday Use', pageW / 2, 19, { align: 'center' })
    doc.setFont('helvetica', 'bold').setFontSize(7).setTextColor(...NAVY)
    doc.text('Technology Solutions.', pageW - margin, 11.5, { align: 'right' })
    doc.text('Built for Impact.', pageW - margin, 15.5, { align: 'right' })
    doc.setDrawColor(...CYAN).setLineWidth(0.7)
    doc.line(margin, 25, pageW - margin, 25)

    doc.setDrawColor(...CYAN).setLineWidth(0.5)
    doc.line(margin, pageH - 15, pageW - margin, pageH - 15)
    doc.setFont('helvetica', 'normal').setFontSize(6.7).setTextColor(...MUTED)
    doc.text([co.website, co.email, co.phone].filter(Boolean).join('   |   '), margin, pageH - 8.5)
    doc.setFont('helvetica', 'bold').setTextColor(...NAVY)
    doc.text(`Page ${pageNumber}   |   People. Technology. A Brighter Tomorrow.`, pageW - margin, pageH - 8.5, { align: 'right' })
  }

  autoTable(doc, {
    startY: 30,
    margin: { left: margin, right: margin, top: 30, bottom: 21 },
    head: [['IMAGE', 'MODEL / SERIES', 'KEY SPECIFICATIONS', 'QTY', 'SELLING PRICE (KES)']],
    body: rows.map(row => ['', row.model, row.specs, String(row.qty), row.priceLabel.replace(/^KES\s*/, '')]),
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 7.4,
      textColor: INK,
      lineColor: BORDER,
      lineWidth: 0.2,
      cellPadding: 2.1,
      minCellHeight: 13.5,
      valign: 'middle',
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: NAVY,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      halign: 'center',
      fontSize: 7.2,
      minCellHeight: 8,
    },
    alternateRowStyles: { fillColor: PALE_BLUE },
    columnStyles: {
      0: { cellWidth: 20, halign: 'center' },
      1: { cellWidth: 47, fontStyle: 'bold', textColor: NAVY },
      2: { cellWidth: 74 },
      3: { cellWidth: 15, halign: 'center', fontStyle: 'bold' },
      4: { cellWidth: 29, halign: 'right', fontStyle: 'bold', textColor: NAVY },
    },
    didDrawCell: hook => {
      if (hook.section !== 'body' || hook.column.index !== 0) return
      const row = rows[hook.row.index]
      const data = row?.imageUrl ? images.get(row.imageUrl) : null
      if (!data) return
      try {
        const pad = 1.25
        doc.addImage(
          data,
          imageFormat(data),
          hook.cell.x + pad,
          hook.cell.y + pad,
          hook.cell.width - pad * 2,
          hook.cell.height - pad * 2,
          undefined,
          'FAST',
        )
      } catch { /* keep clean blank image cell */ }
    },
    didDrawPage: () => drawFrame(doc.getNumberOfPages()),
  })

  if (!rows.length) drawFrame(1)
  doc.save(filename.endsWith('.pdf') ? filename : `${filename}.pdf`)
}

function style(fill: string, color: string, bold = false, horizontal: 'left' | 'center' | 'right' = 'left') {
  return {
    fill: { patternType: 'solid', fgColor: { rgb: fill } },
    font: { name: 'Arial', sz: 10, bold, color: { rgb: color } },
    alignment: { vertical: 'center', horizontal, wrapText: true },
    border: {
      top: { style: 'thin', color: { rgb: 'D6E3EF' } },
      bottom: { style: 'thin', color: { rgb: 'D6E3EF' } },
      left: { style: 'thin', color: { rgb: 'D6E3EF' } },
      right: { style: 'thin', color: { rgb: 'D6E3EF' } },
    },
  }
}

export async function exportClientCatalogExcelFromTable(
  headers: string[],
  sourceRows: ExportRow[],
  filename: string,
): Promise<void> {
  const rows = buildClientCatalogRowsFromTable(headers, sourceRows)
  const co = company()
  const XLSX = await loadXlsx()
  const sheet: Array<Array<string | number>> = [
    ['', 'PRODUCT CATALOG', '', '', ''],
    ['', 'Reliable Devices for Work, Learning and Everyday Use', '', '', ''],
    [[co.website, co.email, co.phone].filter(Boolean).join('   |   '), '', '', '', ''],
    [],
    ['Image', 'Model / Series', 'Key Specifications', 'Qty Available', 'Selling Price (KES)'],
    ...rows.map(row => [
      row.imageUrl ? 'Product image' : '',
      row.model,
      row.specs,
      row.qty,
      row.priceMin === row.priceMax ? row.priceMin : row.priceLabel,
    ]),
  ]
  const ws = XLSX.utils.aoa_to_sheet(sheet)
  ws['!merges'] = [
    { s: { r: 0, c: 1 }, e: { r: 0, c: 4 } },
    { s: { r: 1, c: 1 }, e: { r: 1, c: 4 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: 4 } },
  ]
  ws['!cols'] = [{ wch: 17 }, { wch: 34 }, { wch: 62 }, { wch: 14 }, { wch: 20 }]
  ws['!rows'] = [{ hpt: 30 }, { hpt: 22 }, { hpt: 18 }, { hpt: 8 }, { hpt: 30 }, ...rows.map(() => ({ hpt: 48 }))]
  ws['!autofilter'] = { ref: `A5:E${Math.max(5, rows.length + 5)}` }

  const logoUrl = absoluteUrl(co.logoUrl)
  if (ws.A1 && logoUrl && /^https?:\/\//i.test(logoUrl)) {
    ws.A1.t = 'n'
    ws.A1.f = `IMAGE("${logoUrl.replace(/"/g, '""')}","Deed Technologies",0)`
    ws.A1.v = undefined
  } else if (ws.A1) {
    ws.A1.v = co.name
  }
  if (ws.B1) ws.B1.s = { ...style('FFFFFF', '102F67', true, 'center'), font: { name: 'Arial', sz: 20, bold: true, color: { rgb: '102F67' } } }
  if (ws.B2) ws.B2.s = { ...style('FFFFFF', '5D6D84', false, 'center'), font: { name: 'Arial', sz: 10, color: { rgb: '5D6D84' } } }
  if (ws.A3) ws.A3.s = { ...style('FFFFFF', '5D6D84', false, 'center'), font: { name: 'Arial', sz: 9, color: { rgb: '5D6D84' } } }

  for (let col = 0; col < 5; col++) {
    const address = XLSX.utils.encode_cell({ r: 4, c: col })
    if (ws[address]) ws[address].s = style('102F67', 'FFFFFF', true, col >= 3 ? 'center' : 'left')
  }

  rows.forEach((row, index) => {
    const r = index + 5
    for (let col = 0; col < 5; col++) {
      const address = XLSX.utils.encode_cell({ r, c: col })
      const cell = ws[address]
      if (!cell) continue
      cell.s = style(index % 2 === 0 ? 'FFFFFF' : 'EFF7FD', '12213D', col === 1 || col >= 3, col === 3 ? 'center' : col === 4 ? 'right' : 'left')
    }
    const imageCell = ws[XLSX.utils.encode_cell({ r, c: 0 })]
    if (imageCell && row.imageUrl && /^https?:\/\//i.test(row.imageUrl)) {
      imageCell.t = 'n'
      imageCell.f = `IMAGE("${row.imageUrl.replace(/"/g, '""')}","Product image",0)`
      imageCell.v = undefined
    } else if (imageCell && row.imageUrl) {
      imageCell.v = 'View image'
      imageCell.l = { Target: row.imageUrl, Tooltip: 'Open product image' }
    }
    const priceCell = ws[XLSX.utils.encode_cell({ r, c: 4 })]
    if (priceCell && typeof priceCell.v === 'number') priceCell.z = 'KES #,##0'
  })

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Client Catalog')
  XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`, { cellStyles: true })
}
