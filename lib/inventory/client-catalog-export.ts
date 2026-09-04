'use client'

import { getStoredCompanyData } from '@/lib/company'
import { productThumbSource } from '@/lib/product-images'
import { parseSpecsString } from '@/lib/reconfiguration/display-name'
import { catalogBaseName, formatStorageGb } from '@/lib/reconfiguration/unit-selling-name'
import { loadXlsx } from '@/lib/xlsx-lazy'

export type ClientCatalogProduct = {
  id: string
  name: string
  sku?: string | null
  category?: string | null
  salePrice?: number | null
  description?: string | null
  specs?: unknown
  image?: string | null
  productType?: string | null
  deviceRamGb?: number | string | null
  deviceStorageGb?: number | string | null
}

export type ClientCatalogRow = {
  key: string
  model: string
  specs: string
  qty: number
  priceMin: number
  priceMax: number
  priceLabel: string
  imageUrl: string | null
  productIds: string[]
}

export type CatalogExportCompany = {
  name: string
  phone?: string
  email?: string
  website?: string
  logoUrl?: string
}

const NAVY = '#102F67'
const BLUE = '#0A67B2'
const CYAN = '#00AEEF'
const PALE_BLUE = '#EFF7FD'
const BORDER = '#D6E3EF'
const INK = '#12213D'
const MUTED = '#5D6D84'

function clean(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function money(value: number): string {
  return Math.max(0, Number(value) || 0).toLocaleString('en-KE', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
}

function absoluteUrl(value: string | null): string | null {
  if (!value) return null
  if (/^https?:\/\//i.test(value) || value.startsWith('data:image/')) return value
  if (typeof window === 'undefined') return value
  return `${window.location.origin}${value.startsWith('/') ? value : `/${value}`}`
}

function rawProductSpecs(product: ClientCatalogProduct): string {
  if (typeof product.specs === 'string') return clean(product.specs)
  if (product.specs && typeof product.specs === 'object') {
    const record = product.specs as Record<string, unknown>
    const candidates = [record.description, record.summary, record.displayName, record.specs]
    for (const candidate of candidates) {
      const text = clean(candidate)
      if (text) return text
    }
  }
  return clean(product.description)
}

function parseScreen(text: string): string {
  const size = text.match(/\b(\d{1,2}(?:\.\d+)?)\s*(?:["”]|inch(?:es)?\b)/i)?.[1]
  const resolution = text.match(/\b(WUXGA|FHD|QHD\+?|UHD|HD\+?|2K|4K)\b/i)?.[1]?.toUpperCase()
  const touch = /\b(touch|touchscreen|2-in-1|convertible|x360|flip)\b/i.test(text)
  const parts: string[] = []
  if (size) parts.push(`${size}\"`)
  if (resolution) parts.push(resolution)
  if (touch) parts.push('Touch')
  return parts.join(' ')
}

function parseOperatingSystem(text: string): string {
  const match = text.match(/\b(Windows\s*11\s*(?:Pro|Home)?|Windows\s*10\s*(?:Pro|Home)?|FreeDOS|Chrome\s*OS|ChromeOS|macOS)\b/i)
  return match ? clean(match[1]).replace(/\s+/g, ' ') : ''
}

function processorLabel(parsed: ReturnType<typeof parseSpecsString>): string {
  const processor = clean(parsed.processor)
  const generation = clean(parsed.processorGeneration)
  if (!processor && !generation) return ''
  if (processor && generation && processor.toLowerCase().includes(generation.toLowerCase())) return processor
  return clean([generation, processor].filter(Boolean).join(' '))
}

function storageLabel(parsed: ReturnType<typeof parseSpecsString>): string {
  const gb = Number(parsed.primaryStorageGb) || 0
  if (!gb) return ''
  return formatStorageGb(gb, parsed.storageType)
}

function removeSpecTokens(name: string, parsed: ReturnType<typeof parseSpecsString>): string {
  let out = catalogBaseName(name) || clean(name)
  const tokens = [clean(parsed.processorGeneration), clean(parsed.processor)]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
  for (const token of tokens) {
    out = out.replace(new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), ' ')
  }
  out = out
    .replace(/\b(?:Windows\s*(?:10|11)\s*(?:Pro|Home)?|FreeDOS|Chrome\s*OS|ChromeOS|macOS)\b/ig, ' ')
    .replace(/\b\d{1,2}(?:\.\d+)?\s*(?:["”]|inch(?:es)?\b)/ig, ' ')
    .replace(/\s*[-,/|]+\s*$/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
  return out || clean(name)
}

/** Client-facing model title: chassis/model only; CPU/RAM/storage move into Specifications. */
export function clientCatalogModel(product: ClientCatalogProduct): string {
  const source = clean(`${product.name} ${rawProductSpecs(product)}`)
  const parsed = parseSpecsString(source)
  return removeSpecTokens(product.name, parsed)
}

/** Build the concise specification text shown in both PDF and Excel. */
export function clientCatalogSpecs(product: ClientCatalogProduct): string {
  const raw = clean(`${product.name} ${rawProductSpecs(product)}`)
  const parsed = parseSpecsString(raw)
  const parts: string[] = []
  const cpu = processorLabel(parsed)
  if (cpu) parts.push(cpu)
  const ramGb = Number(parsed.totalRamGb) || Number(product.deviceRamGb) || 0
  if (ramGb > 0) parts.push(`${Math.round(ramGb)}GB RAM`)
  const storage = storageLabel(parsed) || (() => {
    const gb = Number(product.deviceStorageGb) || 0
    return gb > 0 ? formatStorageGb(Math.round(gb), 'SSD') : ''
  })()
  if (storage) parts.push(storage)
  const screen = parseScreen(raw)
  if (screen) parts.push(screen)
  const os = parseOperatingSystem(raw)
  if (os) parts.push(os)

  if (parts.length) return parts.join(' | ')
  const fallback = rawProductSpecs(product)
  if (fallback) return fallback.slice(0, 180)
  return 'Standard configuration'
}

function normaliseForGroup(value: string): string {
  return clean(value)
    .toLowerCase()
    .replace(/nvme\s+ssd/g, 'nvme')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function conditionKey(product: ClientCatalogProduct): string {
  return clean(product.productType).toLowerCase() === 'new' ? 'new' : 'refurbished'
}

/**
 * Combine duplicate/similar catalog SKUs into one client row.
 * Same model + same concise specs + same condition are bundled; quantities add.
 * If the bundled SKUs have different list prices, the client sees a clear range.
 */
export function buildClientCatalogRows(
  products: ClientCatalogProduct[],
  qtyForProduct: (product: ClientCatalogProduct) => number,
): ClientCatalogRow[] {
  const grouped = new Map<string, ClientCatalogRow>()

  for (const product of products) {
    const qty = Math.max(0, Math.floor(Number(qtyForProduct(product)) || 0))
    if (qty <= 0) continue
    const model = clientCatalogModel(product)
    const specs = clientCatalogSpecs(product)
    const price = Math.max(0, Number(product.salePrice) || 0)
    const key = `${normaliseForGroup(model)}::${normaliseForGroup(specs)}::${conditionKey(product)}`
    const thumb = productThumbSource(product)
    const imageUrl = thumb && !thumb.speculative ? absoluteUrl(thumb.src) : null
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
        imageUrl,
        productIds: [product.id],
      })
      continue
    }

    existing.qty += qty
    existing.priceMin = Math.min(existing.priceMin, price)
    existing.priceMax = Math.max(existing.priceMax, price)
    existing.priceLabel = existing.priceMin === existing.priceMax
      ? `KES ${money(existing.priceMin)}`
      : `KES ${money(existing.priceMin)} – ${money(existing.priceMax)}`
    if (!existing.imageUrl && imageUrl) existing.imageUrl = imageUrl
    existing.productIds.push(product.id)
  }

  return Array.from(grouped.values())
    .sort((a, b) => a.model.localeCompare(b.model, 'en', { numeric: true, sensitivity: 'base' }))
}

function dataUrlFormat(dataUrl: string): 'PNG' | 'JPEG' {
  return /^data:image\/jpe?g/i.test(dataUrl) ? 'JPEG' : 'PNG'
}

async function fetchDataUrl(url: string | null): Promise<string | null> {
  if (!url) return null
  if (url.startsWith('data:image/')) return url
  try {
    const response = await fetch(url, { credentials: 'include' })
    if (!response.ok) return null
    const blob = await response.blob()
    return await new Promise<string | null>(resolve => {
      const reader = new FileReader()
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null)
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

function companyForExport(): CatalogExportCompany {
  const company = getStoredCompanyData()
  return {
    name: company.name,
    phone: company.phone,
    email: company.email,
    website: clean(company.website).replace(/^https?:\/\//i, '').replace(/\/$/, ''),
    logoUrl: company.logoUrl || '/deed-logo-receipt.png',
  }
}

export async function exportClientCatalogPdf(
  products: ClientCatalogProduct[],
  qtyForProduct: (product: ClientCatalogProduct) => number,
  filename = 'inventory-catalog',
): Promise<void> {
  const rows = buildClientCatalogRows(products, qtyForProduct)
  const company = companyForExport()
  const [{ jsPDF }, autoTableModule] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ])
  const autoTable = autoTableModule.default
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const margin = 10
  const logoData = await fetchDataUrl(absoluteUrl(company.logoUrl || null))
  const imageData = new Map<string, string | null>()
  await Promise.all(rows.map(async row => {
    if (!row.imageUrl || imageData.has(row.imageUrl)) return
    imageData.set(row.imageUrl, await fetchDataUrl(row.imageUrl))
  }))

  const drawPageFrame = (pageNumber: number) => {
    if (logoData) {
      try { doc.addImage(logoData, dataUrlFormat(logoData), margin, 8, 38, 13, undefined, 'FAST') } catch { /* text fallback below */ }
    } else {
      doc.setFont('helvetica', 'bold').setFontSize(20).setTextColor(NAVY)
      doc.text('deed', margin, 18)
      doc.setFontSize(6).setTextColor(BLUE)
      doc.text('TECHNOLOGIES LTD', margin + 1, 22)
    }

    doc.setFont('helvetica', 'bold').setFontSize(17).setTextColor(NAVY)
    doc.text('PRODUCT CATALOG', pageW / 2, 14, { align: 'center' })
    doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(MUTED)
    doc.text('Reliable Devices for Work, Learning and Everyday Use', pageW / 2, 20, { align: 'center' })
    doc.setFont('helvetica', 'bold').setFontSize(7).setTextColor(NAVY)
    doc.text('Technology Solutions.', pageW - margin, 12, { align: 'right' })
    doc.text('Built for Impact.', pageW - margin, 16, { align: 'right' })
    doc.setDrawColor(CYAN).setLineWidth(0.7)
    doc.line(margin, 26, pageW - margin, 26)

    doc.setDrawColor(CYAN).setLineWidth(0.55)
    doc.line(margin, pageH - 16, pageW - margin, pageH - 16)
    doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(MUTED)
    const contact = [company.website, company.email, company.phone].filter(Boolean).join('   |   ')
    doc.text(contact, margin, pageH - 9)
    doc.setFont('helvetica', 'bold').setTextColor(NAVY)
    doc.text(`Page ${pageNumber}   •   People. Technology. A Brighter Tomorrow.`, pageW - margin, pageH - 9, { align: 'right' })
  }

  const body = rows.map(row => [
    '',
    row.model,
    row.specs,
    String(row.qty),
    row.priceLabel.replace(/^KES\s*/, ''),
  ])

  autoTable(doc, {
    startY: 31,
    margin: { left: margin, right: margin, top: 31, bottom: 22 },
    head: [['', 'MODEL / SERIES', 'KEY SPECIFICATIONS', 'QTY', 'SELLING PRICE (KES)']],
    body,
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 7.5,
      textColor: INK,
      lineColor: BORDER,
      lineWidth: 0.2,
      cellPadding: 2.2,
      minCellHeight: 13,
      valign: 'middle',
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: NAVY,
      textColor: '#FFFFFF',
      fontStyle: 'bold',
      halign: 'center',
      fontSize: 7.5,
      minCellHeight: 8,
    },
    alternateRowStyles: { fillColor: PALE_BLUE },
    columnStyles: {
      0: { cellWidth: 20, halign: 'center' },
      1: { cellWidth: 46, fontStyle: 'bold', textColor: NAVY },
      2: { cellWidth: 75 },
      3: { cellWidth: 15, halign: 'center', fontStyle: 'bold' },
      4: { cellWidth: 29, halign: 'right', fontStyle: 'bold', textColor: NAVY },
    },
    didParseCell: hook => {
      if (hook.section === 'body' && hook.column.index === 4) hook.cell.styles.fontSize = 8.2
    },
    didDrawCell: hook => {
      if (hook.section !== 'body' || hook.column.index !== 0) return
      const row = rows[hook.row.index]
      const data = row?.imageUrl ? imageData.get(row.imageUrl) : null
      if (!data) return
      try {
        const pad = 1.3
        doc.addImage(
          data,
          dataUrlFormat(data),
          hook.cell.x + pad,
          hook.cell.y + pad,
          hook.cell.width - pad * 2,
          hook.cell.height - pad * 2,
          undefined,
          'FAST',
        )
      } catch { /* keep cell blank if image is unreadable */ }
    },
    didDrawPage: () => drawPageFrame(doc.getNumberOfPages()),
  })

  if (!rows.length) drawPageFrame(1)
  doc.save(`${filename}.pdf`)
}

function excelStyle(fill: string, color = 'FFFFFF', bold = true) {
  return {
    fill: { patternType: 'solid', fgColor: { rgb: fill.replace('#', '') } },
    font: { bold, color: { rgb: color.replace('#', '') }, name: 'Arial' },
    alignment: { vertical: 'center', wrapText: true },
    border: {
      top: { style: 'thin', color: { rgb: 'D6E3EF' } },
      bottom: { style: 'thin', color: { rgb: 'D6E3EF' } },
      left: { style: 'thin', color: { rgb: 'D6E3EF' } },
      right: { style: 'thin', color: { rgb: 'D6E3EF' } },
    },
  }
}

export async function exportClientCatalogExcel(
  products: ClientCatalogProduct[],
  qtyForProduct: (product: ClientCatalogProduct) => number,
  filename = 'inventory-catalog',
): Promise<void> {
  const rows = buildClientCatalogRows(products, qtyForProduct)
  const company = companyForExport()
  const XLSX = await loadXlsx()
  const headers = ['Image', 'Model / Series', 'Key Specifications', 'Qty Available', 'Selling Price (KES)']
  const data: Array<Array<string | number>> = [
    [company.name],
    ['PRODUCT CATALOG'],
    ['Reliable Devices for Work, Learning and Everyday Use'],
    [[company.website, company.email, company.phone].filter(Boolean).join('   |   ')],
    [],
    headers,
    ...rows.map(row => [
      row.imageUrl ? 'View image' : '',
      row.model,
      row.specs,
      row.qty,
      row.priceMin === row.priceMax ? row.priceMin : row.priceLabel,
    ]),
  ]
  const ws = XLSX.utils.aoa_to_sheet(data)
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 4 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 4 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: 4 } },
    { s: { r: 3, c: 0 }, e: { r: 3, c: 4 } },
  ]
  ws['!cols'] = [
    { wch: 16 },
    { wch: 34 },
    { wch: 58 },
    { wch: 14 },
    { wch: 20 },
  ]
  ws['!rows'] = [
    { hpt: 24 },
    { hpt: 30 },
    { hpt: 20 },
    { hpt: 18 },
    { hpt: 8 },
    { hpt: 28 },
    ...rows.map(() => ({ hpt: 44 })),
  ]
  ws['!autofilter'] = { ref: `A6:E${Math.max(6, rows.length + 6)}` }

  const titleCell = ws.A2
  if (titleCell) titleCell.s = { ...excelStyle(NAVY), font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 20, name: 'Arial' }, alignment: { horizontal: 'center', vertical: 'center' } }
  if (ws.A1) ws.A1.s = { ...excelStyle('FFFFFF', NAVY.slice(1)), font: { bold: true, color: { rgb: NAVY.slice(1) }, sz: 14, name: 'Arial' } }
  if (ws.A3) ws.A3.s = { ...excelStyle('FFFFFF', MUTED.slice(1), false), font: { color: { rgb: MUTED.slice(1) }, sz: 10, name: 'Arial' }, alignment: { horizontal: 'center' } }
  if (ws.A4) ws.A4.s = { ...excelStyle('FFFFFF', MUTED.slice(1), false), font: { color: { rgb: MUTED.slice(1) }, sz: 9, name: 'Arial' }, alignment: { horizontal: 'center' } }

  for (let col = 0; col < headers.length; col++) {
    const address = XLSX.utils.encode_cell({ r: 5, c: col })
    if (ws[address]) ws[address].s = { ...excelStyle(BLUE), alignment: { horizontal: col >= 3 ? 'center' : 'left', vertical: 'center', wrapText: true } }
  }

  rows.forEach((row, index) => {
    const excelRow = index + 6
    for (let col = 0; col < headers.length; col++) {
      const address = XLSX.utils.encode_cell({ r: excelRow, c: col })
      const cell = ws[address]
      if (!cell) continue
      cell.s = {
        ...excelStyle(index % 2 === 0 ? 'FFFFFF' : PALE_BLUE, INK.slice(1), false),
        font: { color: { rgb: INK.slice(1) }, bold: col === 1 || col === 3 || col === 4, name: 'Arial', sz: 10 },
        alignment: { horizontal: col >= 3 ? (col === 4 ? 'right' : 'center') : 'left', vertical: 'center', wrapText: true },
      }
    }
    const imageCell = ws[XLSX.utils.encode_cell({ r: excelRow, c: 0 })]
    if (imageCell && row.imageUrl) {
      imageCell.l = { Target: row.imageUrl, Tooltip: 'Open product image' }
      imageCell.s = { ...imageCell.s, font: { color: { rgb: BLUE.slice(1) }, underline: true, name: 'Arial', sz: 9 } }
    }
    const priceCell = ws[XLSX.utils.encode_cell({ r: excelRow, c: 4 })]
    if (priceCell && typeof priceCell.v === 'number') priceCell.z = 'KES #,##0'
  })

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Client Catalog')
  XLSX.writeFile(wb, `${filename}.xlsx`, { cellStyles: true })
}
