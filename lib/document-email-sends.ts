import { randomUUID } from 'crypto'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'

export const DOCUMENT_EMAIL_SENDS_KEY = 'deed_documentEmailSends'

export type DocumentEmailDocumentType = 'quote' | 'invoice' | 'bill' | 'rfq'

export type DocumentEmailSendStatus = 'success' | 'failed'

export interface DocumentEmailSend {
  id: string
  documentType: DocumentEmailDocumentType
  documentId: string
  documentRef: string
  to: string
  cc: string[]
  subject?: string
  status: DocumentEmailSendStatus
  error?: string
  messageId?: string
  channel?: 'email' | 'whatsapp'
  kind?: 'initial' | 'update'
  sentById?: string
  sentByName?: string
  sentAt: string
}

/** Split a free-text CC field into unique email addresses. */
export function parseEmailList(raw?: string | string[] | null): string[] {
  const parts = Array.isArray(raw)
    ? raw.flatMap(v => String(v).split(/[,;\s]+/))
    : String(raw ?? '').split(/[,;\s]+/)
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of parts) {
    const email = part.trim()
    if (!email || !email.includes('@')) continue
    const key = email.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(email)
  }
  return out
}

export async function listDocumentEmailSends(filters?: {
  documentId?: string
  documentType?: DocumentEmailDocumentType
  limit?: number
}): Promise<DocumentEmailSend[]> {
  const state = await loadAppState([DOCUMENT_EMAIL_SENDS_KEY])
  const all = Array.isArray(state[DOCUMENT_EMAIL_SENDS_KEY])
    ? (state[DOCUMENT_EMAIL_SENDS_KEY] as DocumentEmailSend[])
    : []
  let rows = all
  if (filters?.documentId) {
    rows = rows.filter(r => r.documentId === filters.documentId)
  }
  if (filters?.documentType) {
    rows = rows.filter(r => r.documentType === filters.documentType)
  }
  rows = [...rows].sort((a, b) => String(b.sentAt).localeCompare(String(a.sentAt)))
  const limit = filters?.limit ?? 200
  return rows.slice(0, limit)
}

export async function appendDocumentEmailSend(
  input: Omit<DocumentEmailSend, 'id' | 'sentAt' | 'cc'> & {
    cc?: string[]
    sentAt?: string
  },
): Promise<DocumentEmailSend> {
  const entry: DocumentEmailSend = {
    id: randomUUID(),
    sentAt: input.sentAt || new Date().toISOString(),
    cc: input.cc ?? [],
    documentType: input.documentType,
    documentId: input.documentId,
    documentRef: input.documentRef,
    to: input.to,
    subject: input.subject,
    status: input.status,
    error: input.error,
    messageId: input.messageId,
    channel: input.channel ?? 'email',
    kind: input.kind,
    sentById: input.sentById,
    sentByName: input.sentByName,
  }

  const state = await loadAppState([DOCUMENT_EMAIL_SENDS_KEY])
  const prev = Array.isArray(state[DOCUMENT_EMAIL_SENDS_KEY])
    ? (state[DOCUMENT_EMAIL_SENDS_KEY] as DocumentEmailSend[])
    : []
  // Keep the newest 2,000 sends to bound growth.
  const next = [entry, ...prev].slice(0, 2000)
  await saveStoreKeys({ [DOCUMENT_EMAIL_SENDS_KEY]: JSON.stringify(next) })
  return entry
}
