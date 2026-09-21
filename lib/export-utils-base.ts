'use client'

import { getStoredCompanyData } from '@/lib/company'
import { loadXlsx } from '@/lib/xlsx-lazy'

export type ExportRow = (string | number | null | undefined)[]

/** Download a simple CSV (UTF-8 BOM for Excel). */
export function exportToCsv(
  headers: string[],
  rows: ExportRow[],
  filename: string,
) {
  const escape = (v: string | number | null | undefined) => {
    const s = String(v ?? '')
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
    return s
  }
  const lines = [
    headers.map(escape).join(','),
    ...rows.map(r => r.map(escape).join(',')),
  ]
  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// ─── Excel Export ─────────────────────────────────────────────────────────────
/** Lazy-loads SheetJS so navigating modules doesn't pay for xlsx up front. */
export async function exportToExcel(
  title: string,
  headers: string[],
  rows: ExportRow[],
  filename: string,
) {
  const XLSX = await loadXlsx()
  const co = getStoredCompanyData()
  const sheetData = [
    [co.name],
    [title],
    [`Generated: ${new Date().toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' })}`],
    [],
    headers,
    ...rows.map(r => r.map(c => c ?? '')),
  ]
  const ws = XLSX.utils.aoa_to_sheet(sheetData)

  // Column widths — auto-size to longest value
  const colWidths = headers.map((h, ci) => {
    const max = Math.max(
      h.length,
      ...rows.map(r => String(r[ci] ?? '').length),
    )
    return { wch: Math.min(max + 2, 40) }
  })
  ws['!cols'] = colWidths

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Report')
  XLSX.writeFile(wb, `${filename}.xlsx`)
}

// ─── PDF Export ───────────────────────────────────────────────────────────────
// Uses raw PDF spec (no external dep) — multi-page tables supported.
export function exportToPDF(
  title: string,
  headers: string[],
  rows: ExportRow[],
  filename: string,
  orientation: 'portrait' | 'landscape' = 'landscape',
) {
  const W = orientation === 'landscape' ? 841.89 : 595.28  // A4 points
  const H = orientation === 'landscape' ? 595.28 : 841.89
  const margin = 36
  const usableW = W - margin * 2
  const footerH = 18

  // Column widths proportional to header length
  const totalChars = headers.reduce((s, h) => s + Math.max(h.length, 6), 0)
  const colWidths = headers.map(h => (Math.max(h.length, 6) / totalChars) * usableW)

  const headerH = 18
  const rowH = 14
  const fontSize = 7
  const lineGap = 4

  const encoder = new TextEncoder()
  const escape = (s: string) =>
    String(s ?? '')
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)')
      .replace(/[^\x20-\x7E]/g, '?')
      .substring(0, 35) // truncate long cells

  const co = getStoredCompanyData()

  // Colours
  const BRAND = [0.106, 0.153, 0.384]  // #1B2762
  const WHITE  = [1, 1, 1]
  const STRIPE = [0.973, 0.976, 0.980] // #F8FAFB
  const BORDER = [0.898, 0.902, 0.918] // #E5E7EB

  const drawTitleBlock = (lines: string[], startY: number) => {
    let y = startY
    lines.push(`BT /F2 10 Tf 1 0 0 1 ${margin} ${y} Tm (${escape(co.name)}) Tj ET`)
    y -= 14
    lines.push(`BT /F2 8 Tf 1 0 0 1 ${margin} ${y} Tm (${escape(title)}) Tj ET`)
    y -= 10
    const dateStr = `Generated: ${new Date().toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' })}`
    lines.push(`BT /F1 6 Tf 1 0 0 1 ${margin} ${y} Tm (${escape(dateStr)}) Tj ET`)
    y -= 16
    return y
  }

  const drawTableHeader = (lines: string[], y: number) => {
    lines.push(`${BRAND[0]} ${BRAND[1]} ${BRAND[2]} rg`)
    lines.push(`${margin} ${y - headerH + 4} ${usableW} ${headerH} re f`)
    lines.push(`${WHITE[0]} ${WHITE[1]} ${WHITE[2]} rg`)
    let cx = margin
    headers.forEach((h, i) => {
      lines.push(`BT /F2 ${fontSize} Tf 1 0 0 1 ${cx + 3} ${y - headerH + lineGap + 3} Tm (${escape(h)}) Tj ET`)
      cx += colWidths[i]
    })
    return y - headerH
  }

  const drawFooter = (lines: string[], pageNum: number, pageCount: number) => {
    lines.push(`0.45 0.45 0.45 rg`)
    lines.push(
      `BT /F1 6 Tf 1 0 0 1 ${margin} ${margin - 8} Tm (${escape(`Page ${pageNum} of ${pageCount} · ${rows.length} rows`)}) Tj ET`,
    )
  }

  // First pass: pack rows into page content streams.
  const pageStreams: string[] = []
  let pageLines: string[] = []
  let y = drawTitleBlock(pageLines, H - margin)
  y = drawTableHeader(pageLines, y)
  let globalRowIndex = 0

  const flushPage = () => {
    pageStreams.push(pageLines.join('\n'))
    pageLines = []
  }

  const startContinuationPage = () => {
    flushPage()
    y = H - margin
    pageLines.push(`BT /F2 8 Tf 1 0 0 1 ${margin} ${y} Tm (${escape(`${title} (continued)`)}) Tj ET`)
    y -= 14
    y = drawTableHeader(pageLines, y)
  }

  rows.forEach((row) => {
    if (y < margin + footerH + rowH) {
      startContinuationPage()
    }

    if (globalRowIndex % 2 === 0) {
      pageLines.push(`${STRIPE[0]} ${STRIPE[1]} ${STRIPE[2]} rg`)
      pageLines.push(`${margin} ${y - rowH + 4} ${usableW} ${rowH} re f`)
    }
    pageLines.push(`${BORDER[0]} ${BORDER[1]} ${BORDER[2]} RG`)
    pageLines.push(`${margin} ${y - rowH + 4} m ${margin + usableW} ${y - rowH + 4} l S`)
    pageLines.push(`0 0 0 rg`)

    let cx2 = margin
    row.forEach((cell, ci) => {
      pageLines.push(
        `BT /F1 ${fontSize} Tf 1 0 0 1 ${cx2 + 3} ${y - rowH + lineGap + 1} Tm (${escape(String(cell ?? ''))}) Tj ET`,
      )
      cx2 += colWidths[ci]
    })
    y -= rowH
    globalRowIndex += 1
  })

  if (pageLines.length) flushPage()
  if (pageStreams.length === 0) {
    // Empty report — still emit a titled page.
    pageLines = []
    y = drawTitleBlock(pageLines, H - margin)
    y = drawTableHeader(pageLines, y)
    pageLines.push(`BT /F1 7 Tf 1 0 0 1 ${margin} ${y - 12} Tm (${escape('No rows')}) Tj ET`)
    flushPage()
  }

  const pageCount = pageStreams.length
  // Add footers now that page count is known.
  const pagesWithFooter = pageStreams.map((stream, idx) => {
    const lines = [stream]
    drawFooter(lines, idx + 1, pageCount)
    return lines.join('\n')
  })

  // Object layout:
  // 1 Catalog
  // 2 Pages
  // 3..N Page dicts
  // then content streams
  // then fonts
  const pageDictIds: number[] = []
  const contentIds: number[] = []
  for (let i = 0; i < pageCount; i++) {
    pageDictIds.push(3 + i)
    contentIds.push(3 + pageCount + i)
  }
  const font1Id = 3 + pageCount * 2
  const font2Id = font1Id + 1

  const objects: string[] = []
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objects[2] = `<< /Type /Pages /Kids [${pageDictIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageCount} >>`
  for (let i = 0; i < pageCount; i++) {
    objects[pageDictIds[i]] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W.toFixed(2)} ${H.toFixed(2)}] /Resources << /Font << /F1 ${font1Id} 0 R /F2 ${font2Id} 0 R >> >> /Contents ${contentIds[i]} 0 R >>`
  }
  for (let i = 0; i < pageCount; i++) {
    const streamContent = pagesWithFooter[i]
    const streamLen = encoder.encode(streamContent).length
    objects[contentIds[i]] = `<< /Length ${streamLen} >>\nstream\n${streamContent}\nendstream`
  }
  objects[font1Id] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  objects[font2Id] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>'

  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  const maxId = font2Id
  for (let id = 1; id <= maxId; id++) {
    offsets[id] = encoder.encode(pdf).length
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`
  }
  const xref = encoder.encode(pdf).length
  pdf += `xref\n0 ${maxId + 1}\n0000000000 65535 f \n`
  for (let id = 1; id <= maxId; id++) {
    pdf += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${maxId + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`

  const blob = new Blob([encoder.encode(pdf)], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${filename}.pdf`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
