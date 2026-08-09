/**
 * Bulk label PDF helpers. Uses jsPDF already in the ERP dependency set.
 * Browser-only — call from client event handlers.
 */

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

function conditionShort(productType?: string) {
  const t = String(productType || '').toLowerCase()
  if (t === 'new') return 'NEW'
  if (t === 'refurbished') return 'REFURB'
  return ''
}

function categoryConditionMeta(category?: string, productType?: string) {
  const cat = String(category || '').trim()
  const cond = conditionShort(productType)
  if (cat && cond) return `${cat} · ${cond}`
  return cat || cond || ''
}

function stampFilename(prefix: string) {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${prefix}-${yyyy}-${mm}-${dd}.pdf`
}

export async function downloadProductLabelsPdf(
  items: ProductLabelPdfItem[],
  opts?: { filename?: string; companyName?: string },
): Promise<string> {
  if (!items.length) throw new Error('No products selected')
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const cols = 3
  const rows = 7
  const labelW = 60
  const labelH = 38
  const marginX = 12
  const marginY = 10
  const gapX = 4
  const gapY = 4

  items.forEach((item, index) => {
    const pageIndex = Math.floor(index / (cols * rows))
    if (pageIndex > 0 && index % (cols * rows) === 0) doc.addPage()
    const local = index % (cols * rows)
    const col = local % cols
    const row = Math.floor(local / cols)
    const x = marginX + col * (labelW + gapX)
    const y = marginY + row * (labelH + gapY)

    doc.setDrawColor(200, 200, 200)
    doc.roundedRect(x, y, labelW, labelH, 1.5, 1.5)
    doc.setFontSize(8)
    doc.setTextColor(0, 176, 215)
    doc.setFont('helvetica', 'bold')
    doc.text(opts?.companyName || 'deed.', x + 2.5, y + 6)
    doc.setTextColor(100, 116, 139)
    doc.setFontSize(6)
    doc.text(categoryConditionMeta(item.category, item.productType).toUpperCase().slice(0, 22), x + labelW - 2.5, y + 6, { align: 'right' })
    doc.setTextColor(15, 23, 42)
    doc.setFontSize(8)
    doc.setFont('helvetica', 'bold')
    const nameLines = doc.splitTextToSize(item.name, labelW - 5)
    doc.text(nameLines.slice(0, 2), x + 2.5, y + 12)
    if (item.specs) {
      doc.setFontSize(5.5)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(71, 85, 105)
      doc.text(String(item.specs).slice(0, 42), x + 2.5, y + 18)
    }
    if (typeof item.salePrice === 'number') {
      doc.setFontSize(11)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(26, 31, 94)
      doc.text(`KES ${Math.round(item.salePrice).toLocaleString('en-KE')}`, x + 2.5, y + 23)
    }
    doc.setFontSize(6)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(80, 80, 80)
    doc.text(item.barcode || item.sku, x + labelW / 2, y + 30, { align: 'center' })
    doc.text(`SKU: ${item.sku}`, x + labelW / 2, y + 34, { align: 'center' })
  })

  const filename = opts?.filename || stampFilename('product-labels')
  doc.save(filename)
  return filename
}

export async function downloadSerialLabelsPdf(
  items: SerialLabelPdfItem[],
  opts?: { filename?: string; companyName?: string },
): Promise<string> {
  if (!items.length) throw new Error('No serials selected')
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const cols = 3
  const rows = 7
  const labelW = 60
  const labelH = 38
  const marginX = 12
  const marginY = 10
  const gapX = 4
  const gapY = 4

  items.forEach((item, index) => {
    const pageIndex = Math.floor(index / (cols * rows))
    if (pageIndex > 0 && index % (cols * rows) === 0) doc.addPage()
    const local = index % (cols * rows)
    const col = local % cols
    const row = Math.floor(local / cols)
    const x = marginX + col * (labelW + gapX)
    const y = marginY + row * (labelH + gapY)

    doc.setDrawColor(200, 200, 200)
    doc.setFillColor(255, 255, 255)
    doc.roundedRect(x, y, labelW, labelH, 1.5, 1.5)
    doc.setDrawColor(26, 31, 94)
    doc.setLineWidth(0.8)
    doc.line(x, y + 2, x, y + labelH - 2)
    doc.setLineWidth(0.2)

    doc.setFontSize(8)
    doc.setTextColor(0, 176, 215)
    doc.setFont('helvetica', 'bold')
    doc.text(opts?.companyName || 'deed.', x + 3, y + 6)
    doc.setFontSize(5.5)
    doc.setTextColor(100, 116, 139)
    doc.text(categoryConditionMeta(item.category, item.productType).toUpperCase().slice(0, 22), x + labelW - 3, y + 6, { align: 'right' })
    doc.setTextColor(15, 23, 42)
    doc.setFontSize(7)
    const nameLines = doc.splitTextToSize(item.productName, labelW - 8)
    doc.text(nameLines.slice(0, 2), x + 3, y + 11)
    if (item.specs) {
      doc.setFontSize(5)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(71, 85, 105)
      doc.text(String(item.specs).slice(0, 40), x + 3, y + 17)
    }
    doc.setFontSize(5.5)
    doc.setTextColor(100, 116, 139)
    doc.setFont('helvetica', 'bold')
    doc.text('SERIAL NO.', x + 3, y + 21)
    doc.setTextColor(26, 31, 94)
    doc.setFontSize(10)
    doc.setFont('courier', 'bold')
    doc.text(item.serial.slice(0, 22), x + 3, y + 27)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6)
    doc.setTextColor(71, 85, 105)
    doc.text(`SKU ${item.sku}`, x + 3, y + 33)
  })

  const filename = opts?.filename || stampFilename('inventory-serial-labels')
  doc.save(filename)
  return filename
}
