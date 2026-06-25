import 'server-only'

import crypto from 'node:crypto'
import prisma from '@/lib/prisma'
import { loadAppState } from '@/lib/server-store'

interface SOPDocStep {
  id: string
  order: number
  instruction: string
  note?: string
}

interface SOPDocument {
  id: string
  title: string
  category?: string
  department?: string
  purpose?: string
  scope?: string
  steps?: SOPDocStep[]
  status?: 'draft' | 'active' | 'archived'
  fileName?: string
  fileType?: string
}

const CHUNK_SIZE = 1200
const CHUNK_OVERLAP = 150

function chunkText(text: string): string[] {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return []
  const chunks: string[] = []
  let start = 0
  while (start < clean.length) {
    const end = Math.min(start + CHUNK_SIZE, clean.length)
    chunks.push(clean.slice(start, end))
    if (end === clean.length) break
    start = end - CHUNK_OVERLAP
  }
  return chunks
}

function sopToText(sop: SOPDocument): string {
  const parts = [
    `Title: ${sop.title}`,
    sop.purpose ? `Purpose: ${sop.purpose}` : '',
    sop.scope ? `Scope: ${sop.scope}` : '',
    ...(sop.steps ?? [])
      .sort((a, b) => a.order - b.order)
      .map(s => `Step ${s.order}: ${s.instruction}${s.note ? ` (Note: ${s.note})` : ''}`),
  ]
  return parts.filter(Boolean).join('\n')
}

function checksumOf(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex')
}

async function extractImageText(buffer: Buffer): Promise<string | null> {
  try {
    const { recognize } = await import('tesseract.js')
    const result = await recognize(buffer, 'eng', { logger: () => undefined })
    return result.data.text ?? null
  } catch (err) {
    console.error('[jarvis] OCR extraction failed:', err)
    return null
  }
}

function parseDataUrl(dataUrl: string): { contentType: string; buffer: Buffer } | null {
  const match = dataUrl.match(/^data:([^;,]+);base64,([\s\S]*)$/)
  if (!match) return null
  try {
    return { contentType: match[1] || 'application/octet-stream', buffer: Buffer.from(match[2], 'base64') }
  } catch {
    return null
  }
}

export interface IngestResult {
  documentId: string
  title: string
  status: 'ready' | 'unsupported' | 'failed' | 'unchanged'
  chunkCount: number
}

async function upsertDocument(sourceType: string, sourceId: string, title: string, mimeType: string, text: string): Promise<IngestResult> {
  const checksum = checksumOf(text)

  const existing = await prisma.aiDocument.findUnique({
    where: { sourceType_sourceId: { sourceType, sourceId } },
  })

  if (existing && existing.checksum === checksum) {
    return { documentId: existing.id, title, status: 'unchanged', chunkCount: 0 }
  }

  const chunks = chunkText(text)
  const status = chunks.length > 0 ? 'ready' : 'unsupported'

  const document = await prisma.aiDocument.upsert({
    where: { sourceType_sourceId: { sourceType, sourceId } },
    create: { sourceType, sourceId, title, mimeType, checksum, status },
    update: { title, mimeType, checksum, status },
  })

  await prisma.aiDocumentChunk.deleteMany({ where: { documentId: document.id } })
  if (chunks.length > 0) {
    await prisma.aiDocumentChunk.createMany({
      data: chunks.map((content, chunkIndex) => ({ documentId: document.id, chunkIndex, content })),
    })
  }

  return { documentId: document.id, title, status: status as IngestResult['status'], chunkCount: chunks.length }
}

// Ingests every SOP document's structured text, plus OCR text from any
// image attachment. PDF/DOCX attachment byte-extraction is not implemented
// yet (no PDF/DOCX parsing library is installed) — those SOPs are still
// ingested from their structured title/purpose/scope/steps fields, just
// without the attached file's own text.
export async function ingestSopDocuments(): Promise<IngestResult[]> {
  const state = await loadAppState(['deed_sop_documents'])
  const sops = (state.deed_sop_documents as SOPDocument[] | undefined) ?? []

  const results: IngestResult[] = []

  for (const sop of sops) {
    if (!sop.id || !sop.title) continue
    if (sop.status === 'archived') continue

    let text = sopToText(sop)

    if (sop.fileName && sop.fileType?.startsWith('image/')) {
      const fileState = await loadAppState([`sop_file_${sop.id}`])
      const raw = fileState[`sop_file_${sop.id}`]
      if (typeof raw === 'string') {
        const parsed = parseDataUrl(raw)
        if (parsed) {
          const ocrText = await extractImageText(parsed.buffer)
          if (ocrText) text += `\n\nAttachment OCR text:\n${ocrText}`
        }
      }
    }

    const result = await upsertDocument('sop', sop.id, sop.title, sop.fileType ?? 'text/plain', text)
    results.push(result)
  }

  return results
}
