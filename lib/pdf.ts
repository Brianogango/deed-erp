'use client'

export interface PdfLine {
  text: string
  x?: number
  y?: number
  size?: number
  bold?: boolean
}

const encoder = new TextEncoder()

const byteLength = (value: string) => encoder.encode(value).length

const escapePdfText = (value: string) =>
  value
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[^\x20-\x7E]/g, '?')

const buildContentStream = (lines: PdfLine[]) => lines.map(line => {
  const x = line.x ?? 40
  const y = line.y ?? 800
  const size = line.size ?? 12
  const font = line.bold ? 'F2' : 'F1'
  return `BT /${font} ${size} Tf 1 0 0 1 ${x} ${y} Tm (${escapePdfText(line.text)}) Tj ET`
}).join('\n')

export const createPdfBlob = (lines: PdfLine[]) => {
  const content = buildContentStream(lines)
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${byteLength(content)} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
  ]

  let pdf = '%PDF-1.4\n'
  const offsets: number[] = [0]

  objects.forEach((object, index) => {
    offsets.push(byteLength(pdf))
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  })

  const xrefOffset = byteLength(pdf)
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  offsets.slice(1).forEach(offset => {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  })
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`

  return new Blob([encoder.encode(pdf)], { type: 'application/pdf' })
}

const createObjectUrl = (lines: PdfLine[]) => URL.createObjectURL(createPdfBlob(lines))

export const downloadPdf = (fileName: string, lines: PdfLine[]) => {
  const url = createObjectUrl(lines)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName.replace(/[/\\]/g, '-')
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const printPdf = (fileName: string, lines: PdfLine[]) => {
  const url = createObjectUrl(lines)
  const frame = document.createElement('iframe')
  frame.style.position = 'fixed'
  frame.style.right = '0'
  frame.style.bottom = '0'
  frame.style.width = '0'
  frame.style.height = '0'
  frame.style.border = '0'
  frame.src = url
  document.body.appendChild(frame)
  frame.onload = () => {
    frame.contentWindow?.focus()
    frame.contentWindow?.print()
  }
  window.setTimeout(() => {
    if (frame.parentNode) frame.parentNode.removeChild(frame)
    URL.revokeObjectURL(url)
  }, 60000)
}
