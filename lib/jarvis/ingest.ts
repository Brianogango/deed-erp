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

interface WpRendered {
  rendered?: string
}

interface WpContentItem {
  id: number
  link?: string
  modified?: string
  title?: WpRendered
  content?: WpRendered
  excerpt?: WpRendered
  status?: string
  type?: string
}

const CHUNK_SIZE = 1200
const CHUNK_OVERLAP = 150
const DEFAULT_WEBSITE = 'https://deed.africa'

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

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#8217;/g, "'")
    .replace(/&#8211;/g, '–')
    .replace(/&#8212;/g, '—')
}

/** Strip HTML from WP rendered content without adding a HTML parser dependency. */
export function htmlToPlainText(html: string): string {
  const withoutBlocks = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(p|div|h[1-6]|li|tr|br|hr)>/gi, '\n')
    .replace(/<(br|hr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
  return decodeEntities(withoutBlocks).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim()
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
  sourceType?: string
  sourceUrl?: string | null
}

export async function upsertDocument(params: {
  sourceType: string
  sourceId: string
  title: string
  mimeType: string
  text: string
  sourceUrl?: string | null
  category?: string | null
}): Promise<IngestResult> {
  const { sourceType, sourceId, title, mimeType, text, sourceUrl, category } = params
  const checksum = checksumOf(text)

  const existing = await prisma.aiDocument.findUnique({
    where: { sourceType_sourceId: { sourceType, sourceId } },
  })

  if (existing && existing.checksum === checksum) {
    return {
      documentId: existing.id,
      title,
      status: 'unchanged',
      chunkCount: 0,
      sourceType,
      sourceUrl: existing.sourceUrl,
    }
  }

  const chunks = chunkText(text)
  const status = chunks.length > 0 ? 'ready' : 'unsupported'

  const document = await prisma.aiDocument.upsert({
    where: { sourceType_sourceId: { sourceType, sourceId } },
    create: {
      sourceType,
      sourceId,
      title,
      mimeType,
      checksum,
      status,
      sourceUrl: sourceUrl ?? null,
      category: category ?? null,
    },
    update: {
      title,
      mimeType,
      checksum,
      status,
      sourceUrl: sourceUrl ?? null,
      category: category ?? null,
    },
  })

  await prisma.aiDocumentChunk.deleteMany({ where: { documentId: document.id } })
  if (chunks.length > 0) {
    await prisma.aiDocumentChunk.createMany({
      data: chunks.map((content, chunkIndex) => ({ documentId: document.id, chunkIndex, content })),
    })
  }

  return {
    documentId: document.id,
    title,
    status: status as IngestResult['status'],
    chunkCount: chunks.length,
    sourceType,
    sourceUrl: sourceUrl ?? null,
  }
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

    const result = await upsertDocument({
      sourceType: 'sop',
      sourceId: sop.id,
      title: sop.title,
      mimeType: sop.fileType ?? 'text/plain',
      text,
      category: sop.category ?? sop.department ?? 'sop',
    })
    results.push(result)
  }

  return results
}

function websiteBaseUrl(): string {
  const raw = (process.env.DEED_WEBSITE_URL || DEFAULT_WEBSITE).trim().replace(/\/$/, '')
  return raw || DEFAULT_WEBSITE
}

async function fetchWpCollection(baseUrl: string, collection: 'pages' | 'posts'): Promise<WpContentItem[]> {
  const items: WpContentItem[] = []
  const perPage = 50
  for (let page = 1; page <= 20; page++) {
    const url =
      `${baseUrl}/wp-json/wp/v2/${collection}` +
      `?per_page=${perPage}&page=${page}&status=publish` +
      `&_fields=id,link,title,content,excerpt,modified,status,type`
    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'DeedERP-JARVIS-Ingest/1.0' },
      signal: AbortSignal.timeout(25_000),
      next: { revalidate: 0 },
    })
    if (res.status === 400 || res.status === 404) break
    if (!res.ok) {
      throw new Error(`WordPress ${collection} fetch failed (${res.status}) from ${url}`)
    }
    const batch = (await res.json()) as WpContentItem[]
    if (!Array.isArray(batch) || batch.length === 0) break
    items.push(...batch)
    if (batch.length < perPage) break
  }
  return items
}

/**
 * Crawl public marketing/knowledge content via WordPress REST — never the ERP UI.
 * Indexes policies, FAQs, product/service pages into the same FTS knowledge store as SOPs.
 */
export async function ingestWebsiteDocuments(baseUrl = websiteBaseUrl()): Promise<IngestResult[]> {
  const [pages, posts] = await Promise.all([
    fetchWpCollection(baseUrl, 'pages'),
    fetchWpCollection(baseUrl, 'posts'),
  ])

  const results: IngestResult[] = []
  const all = [
    ...pages.map(p => ({ ...p, kind: 'page' as const })),
    ...posts.map(p => ({ ...p, kind: 'post' as const })),
  ]

  for (const item of all) {
    const title = decodeEntities(item.title?.rendered ?? '').trim()
    if (!item.id || !title) continue
    const body = htmlToPlainText(item.content?.rendered ?? '')
    const excerpt = htmlToPlainText(item.excerpt?.rendered ?? '')
    const text = [
      `Title: ${title}`,
      item.link ? `URL: ${item.link}` : '',
      excerpt ? `Summary: ${excerpt}` : '',
      body ? `Content:\n${body}` : '',
    ].filter(Boolean).join('\n\n')

    if (text.replace(/\s+/g, ' ').trim().length < 40) continue

    const result = await upsertDocument({
      sourceType: 'website',
      sourceId: `${item.kind}-${item.id}`,
      title,
      mimeType: 'text/html',
      text,
      sourceUrl: item.link ?? null,
      category: item.kind,
    })
    results.push(result)
  }

  return results
}

export async function ingestAllKnowledge(): Promise<{
  sop: IngestResult[]
  website: IngestResult[]
}> {
  const sop = await ingestSopDocuments()
  let website: IngestResult[] = []
  try {
    website = await ingestWebsiteDocuments()
  } catch (err) {
    console.error('[jarvis] website ingest failed:', err)
    website = [{
      documentId: '',
      title: 'website-ingest',
      status: 'failed',
      chunkCount: 0,
      sourceType: 'website',
    }]
  }
  return { sop, website }
}
