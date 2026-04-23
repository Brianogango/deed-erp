'use client'

import * as XLSX from 'xlsx'
import { getStoredCompanyData } from '@/lib/company'

export type ExportRow = (string | number | null | undefined)[]

// ─── Excel Export ─────────────────────────────────────────────────────────────
export function exportToExcel(
  title: string,
  headers: string[],
  rows: ExportRow[],
  filename: string,
) {
  const co = getStoredCompanyData()
  const sheetData = [
    [co.name],
    [title],
    [`Generated: ${new Date().toLocaleString()}`],
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
// Uses raw PDF spec (no external dep) — handles tables up to ~50 columns
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

  const lines: string[] = []

  const co = getStoredCompanyData()

  // Colours
  const BRAND = [0.106, 0.153, 0.384]  // #1B2762
  const WHITE  = [1, 1, 1]
  const STRIPE = [0.973, 0.976, 0.980] // #F8FAFB
  const BORDER = [0.898, 0.902, 0.918] // #E5E7EB

  let y = H - margin

  // ── Company name ────────────────────────────────────────────────────────────
  lines.push(`BT /F2 10 Tf 1 0 0 1 ${margin} ${y} Tm (${escape(co.name)}) Tj ET`)
  y -= 14
  // ── Report title ────────────────────────────────────────────────────────────
  lines.push(`BT /F2 8 Tf 1 0 0 1 ${margin} ${y} Tm (${escape(title)}) Tj ET`)
  y -= 10
  // ── Date line ───────────────────────────────────────────────────────────────
  const dateStr = `Generated: ${new Date().toLocaleString()}`
  lines.push(`BT /F1 6 Tf 1 0 0 1 ${margin} ${y} Tm (${escape(dateStr)}) Tj ET`)
  y -= 16

  // ── Header row ──────────────────────────────────────────────────────────────
  // Background
  lines.push(`${BRAND[0]} ${BRAND[1]} ${BRAND[2]} rg`)
  lines.push(`${margin} ${y - headerH + 4} ${usableW} ${headerH} re f`)
  lines.push(`${WHITE[0]} ${WHITE[1]} ${WHITE[2]} rg`)

  let cx = margin
  headers.forEach((h, i) => {
    lines.push(`BT /F2 ${fontSize} Tf 1 0 0 1 ${cx + 3} ${y - headerH + lineGap + 3} Tm (${escape(h)}) Tj ET`)
    cx += colWidths[i]
  })
  y -= headerH

  // ── Data rows ───────────────────────────────────────────────────────────────
  const allStreamLines: string[] = [...lines]
  const rowLines: string[] = []

  rows.forEach((row, ri) => {
    if (y < margin + rowH) return // skip overflow rows

    // Stripe
    if (ri % 2 === 0) {
      rowLines.push(`${STRIPE[0]} ${STRIPE[1]} ${STRIPE[2]} rg`)
      rowLines.push(`${margin} ${y - rowH + 4} ${usableW} ${rowH} re f`)
    }
    // Bottom border
    rowLines.push(`${BORDER[0]} ${BORDER[1]} ${BORDER[2]} RG`)
    rowLines.push(`${margin} ${y - rowH + 4} m ${margin + usableW} ${y - rowH + 4} l S`)

    rowLines.push(`0 0 0 rg`)
    let cx2 = margin
    row.forEach((cell, ci) => {
      rowLines.push(`BT /F1 ${fontSize} Tf 1 0 0 1 ${cx2 + 3} ${y - rowH + lineGap + 1} Tm (${escape(String(cell ?? ''))}) Tj ET`)
      cx2 += colWidths[ci]
    })
    y -= rowH
  })

  const streamContent = [...allStreamLines, ...rowLines].join('\n')
  const streamLen = encoder.encode(streamContent).length

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W.toFixed(2)} ${H.toFixed(2)}] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${streamLen} >>\nstream\n${streamContent}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
  ]

  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((obj, i) => {
    offsets.push(encoder.encode(pdf).length)
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`
  })
  const xref = encoder.encode(pdf).length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  offsets.forEach(o => { pdf += `${String(o).padStart(10, '0')} 00000 n \n` })
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`

  const blob = new Blob([encoder.encode(pdf)], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = `${filename}.pdf`
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
