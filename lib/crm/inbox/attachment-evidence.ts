/**
 * Pull lightweight text evidence from inbound attachments (RFQ.pdf, xlsx, txt).
 * Used only to enrich classification — never replaces the email body as source of truth.
 */

import type { InboundEmailAttachmentMeta } from '@/lib/crm/sales-inbox-leads'

const MAX_CHARS = 4000
const MAX_FILES = 5
const MAX_BYTES = 2 * 1024 * 1024

export interface AttachmentEvidence {
  text: string
  sources: Array<{ filename: string; kind: string; chars: number }>
}

function bufferOf(att: InboundEmailAttachmentMeta): Buffer | null {
  if (att.content && Buffer.isBuffer(att.content)) return att.content
  if (att.contentBase64) {
    try {
      return Buffer.from(att.contentBase64, 'base64')
    } catch {
      return null
    }
  }
  return null
}

/** Crude PDF text: pull printable strings from literal / stream content. */
export function crudePdfText(buf: Buffer): string {
  const latin = buf.toString('latin1')
  const chunks: string[] = []
  const paren = /\((?:\\.|[^\\)]){3,200}\)/g
  let m: RegExpExecArray | null
  while ((m = paren.exec(latin)) && chunks.join(' ').length < MAX_CHARS) {
    const raw = m[0].slice(1, -1)
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '')
      .replace(/\\t/g, ' ')
      .replace(/\\([()\\])/g, '$1')
    const cleaned = raw.replace(/[^\x09\x0a\x0d\x20-\x7e\u00a0-\u024f]/g, ' ').trim()
    if (cleaned.length >= 3) chunks.push(cleaned)
  }
  // Tj / TJ operator leftovers often include readable runs
  const tj = /(?:Tj|TJ)\s*/gi
  void tj
  return chunks.join(' ').replace(/\s+/g, ' ').trim().slice(0, MAX_CHARS)
}

function extractPlain(buf: Buffer): string {
  return buf.toString('utf8').replace(/\0/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_CHARS)
}

function extractHtml(buf: Buffer): string {
  return extractPlain(buf)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_CHARS)
}

function extractXlsx(buf: Buffer): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const XLSX = require('xlsx') as typeof import('xlsx')
    const wb = XLSX.read(buf, { type: 'buffer', bookSheets: false })
    const parts: string[] = []
    for (const name of wb.SheetNames.slice(0, 3)) {
      const sheet = wb.Sheets[name]
      if (!sheet) continue
      const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false })
      if (csv.trim()) parts.push(`Sheet ${name}:\n${csv.trim()}`)
      if (parts.join('\n').length >= MAX_CHARS) break
    }
    return parts.join('\n\n').slice(0, MAX_CHARS)
  } catch {
    return ''
  }
}

function kindOf(att: InboundEmailAttachmentMeta): 'pdf' | 'xlsx' | 'text' | 'html' | 'skip' {
  const name = (att.filename || '').toLowerCase()
  const ct = (att.contentType || '').toLowerCase()
  if (ct.includes('pdf') || name.endsWith('.pdf')) return 'pdf'
  if (
    ct.includes('spreadsheet')
    || ct.includes('excel')
    || name.endsWith('.xlsx')
    || name.endsWith('.xls')
    || name.endsWith('.csv')
  ) return 'xlsx'
  if (ct.startsWith('text/plain') || name.endsWith('.txt') || name.endsWith('.csv')) return 'text'
  if (ct.includes('html') || name.endsWith('.html') || name.endsWith('.htm')) return 'html'
  return 'skip'
}

/**
 * Extract classification evidence from up to MAX_FILES attachments.
 */
export function extractAttachmentEvidence(
  attachments: InboundEmailAttachmentMeta[] | undefined | null,
): AttachmentEvidence {
  const sources: AttachmentEvidence['sources'] = []
  const texts: string[] = []
  if (!attachments?.length) return { text: '', sources }

  for (const att of attachments.slice(0, MAX_FILES)) {
    const kind = kindOf(att)
    if (kind === 'skip') continue
    const buf = bufferOf(att)
    if (!buf || buf.length === 0 || buf.length > MAX_BYTES) continue

    let text = ''
    if (kind === 'pdf') text = crudePdfText(buf)
    else if (kind === 'xlsx') text = extractXlsx(buf)
    else if (kind === 'html') text = extractHtml(buf)
    else text = extractPlain(buf)

    if (!text) continue
    sources.push({ filename: att.filename || 'attachment', kind, chars: text.length })
    texts.push(`[Attachment: ${att.filename || 'file'}]\n${text}`)
  }

  return {
    text: texts.join('\n\n').slice(0, MAX_CHARS * 2),
    sources,
  }
}

/** Merge attachment evidence into a body copy used only for classification. */
export function withAttachmentEvidenceBody(
  textBody: string,
  evidence: AttachmentEvidence,
): string {
  if (!evidence.text) return textBody || ''
  return `${textBody || ''}\n\n--- attachment evidence ---\n${evidence.text}`.slice(0, 20000)
}
