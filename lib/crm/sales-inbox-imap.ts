import 'server-only'
import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import {
  normalizeMessageId,
  type ParsedInboundEmail,
} from '@/lib/crm/sales-inbox-leads'

export interface SalesImapConfig {
  host: string
  port: number
  secure: boolean
  user: string
  pass: string
  mailbox: string
}

/** Resolve IMAP config from env. Falls back to sales SMTP + mail host. */
export function resolveSalesImapConfig(env: NodeJS.ProcessEnv = process.env): SalesImapConfig | null {
  const user = (
    env.SALES_IMAP_USER ||
    env.SALES_SMTP_USER ||
    env.SALES_EMAIL ||
    'sales@deed.co.ke'
  ).trim().replace(/^"|"$/g, '')

  const pass = (
    env.SALES_IMAP_PASS ||
    env.SALES_SMTP_PASS ||
    ''
  ).trim().replace(/^"|"$/g, '')

  if (!pass) return null

  const host = (
    env.SALES_IMAP_HOST ||
    env.SMTP_HOST ||
    'mail.deed.co.ke'
  ).trim().replace(/^"|"$/g, '')

  const port = Math.max(1, Number(env.SALES_IMAP_PORT || 993) || 993)
  const secure = env.SALES_IMAP_SECURE
    ? !['0', 'false', 'no'].includes(String(env.SALES_IMAP_SECURE).toLowerCase())
    : port === 993

  return {
    host,
    port,
    secure,
    user,
    pass,
    mailbox: (env.SALES_IMAP_MAILBOX || 'INBOX').trim() || 'INBOX',
  }
}

export function salesInboxConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveSalesImapConfig(env) !== null
}

function addressEmail(value: unknown): { email: string; name: string } {
  if (!value) return { email: '', name: '' }
  if (typeof value === 'object' && value !== null && 'value' in (value as object)) {
    const list = (value as { value?: Array<{ address?: string; name?: string }> }).value
    const first = Array.isArray(list) ? list[0] : undefined
    return {
      email: String(first?.address || '').trim(),
      name: String(first?.name || '').trim(),
    }
  }
  const text = String(value)
  const angle = text.match(/^(.*?)<([^>]+)>/)
  if (angle) {
    return { email: angle[2].trim(), name: angle[1].replace(/"/g, '').trim() }
  }
  return { email: text.trim(), name: '' }
}

function headerValue(headers: unknown, key: string): string | undefined {
  if (!headers || typeof headers !== 'object') return undefined
  const h = headers as { get?: (k: string) => unknown }
  if (typeof h.get !== 'function') return undefined
  const v = h.get(key)
  if (v == null) return undefined
  if (Array.isArray(v)) return String(v[0] ?? '')
  return String(v)
}

/**
 * Fetch recent UNSEEN messages (or recent SEEN within lookback) and parse them.
 * Marks processed UIDs as seen only when `markSeen` is true (after successful lead create).
 */
export async function fetchSalesInboxEmails(opts: {
  config: SalesImapConfig
  limit?: number
  /** When true, also include recent seen mail (for first backfill). Default: unseen only. */
  includeRecentSeen?: boolean
  lookbackHours?: number
}): Promise<Array<ParsedInboundEmail & { uid: number; rawSource?: Buffer }>> {
  const limit = Math.min(50, Math.max(1, opts.limit ?? 20))
  const client = new ImapFlow({
    host: opts.config.host,
    port: opts.config.port,
    secure: opts.config.secure,
    auth: { user: opts.config.user, pass: opts.config.pass },
    logger: false,
  })

  const out: Array<ParsedInboundEmail & { uid: number; rawSource?: Buffer }> = []

  try {
    await client.connect()
    const lock = await client.getMailboxLock(opts.config.mailbox)
    try {
      let uids: number[] = []
      const unseen = await client.search({ seen: false }, { uid: true })
      uids = Array.isArray(unseen) ? unseen.map(Number).filter(n => n > 0) : []

      if (opts.includeRecentSeen) {
        const since = new Date(Date.now() - Math.max(1, opts.lookbackHours ?? 72) * 3600_000)
        const recent = await client.search({ since }, { uid: true })
        const recentUids = Array.isArray(recent) ? recent.map(Number).filter(n => n > 0) : []
        uids = [...new Set([...uids, ...recentUids])]
      }

      uids.sort((a, b) => a - b)
      const slice = uids.slice(-limit)

      for await (const msg of client.fetch(slice, { uid: true, source: true, envelope: true }, { uid: true })) {
        const source = msg.source
        if (!source) continue
        const parsed = await simpleParser(source)
        const from = addressEmail(parsed.from)
        const messageId = normalizeMessageId(
          parsed.messageId || msg.envelope?.messageId,
          `${opts.config.user}:${msg.uid}`,
        )
        const d = parsed.date || msg.envelope?.date
        const dateIso = d instanceof Date
          ? d.toISOString()
          : d
            ? new Date(d).toISOString()
            : new Date().toISOString()
        out.push({
          uid: msg.uid,
          messageId,
          fromEmail: from.email,
          fromName: from.name,
          subject: String(parsed.subject || msg.envelope?.subject || '').trim(),
          textBody: String(parsed.text || '').trim() || String(parsed.html || '').replace(/<[^>]+>/g, ' ').trim(),
          dateIso,
          inReplyTo: parsed.inReplyTo ? String(parsed.inReplyTo) : undefined,
          references: parsed.references
            ? (Array.isArray(parsed.references) ? parsed.references.join(' ') : String(parsed.references))
            : undefined,
          providerThreadId: headerValue(parsed.headers, 'x-gm-thrid') || undefined,
          autoSubmitted: headerValue(parsed.headers, 'auto-submitted'),
          listUnsubscribe: headerValue(parsed.headers, 'list-unsubscribe'),
          precedence: headerValue(parsed.headers, 'precedence'),
          attachments: (parsed.attachments ?? [])
            .filter(att => {
              const name = String(att.filename || '').trim()
              if (!name) return false
              // Skip tiny related/inline CID images (signatures); keep real files.
              if (att.related && (att.contentType || '').startsWith('image/') && (att.size ?? 0) < 40_000) {
                return false
              }
              return (att.size ?? att.content?.length ?? 0) > 0
            })
            .slice(0, 10)
            .map(att => ({
              filename: String(att.filename || 'attachment').slice(0, 200),
              contentType: String(att.contentType || 'application/octet-stream').slice(0, 120),
              size: Number(att.size || att.content?.length || 0),
              content: Buffer.isBuffer(att.content)
                ? att.content
                : Buffer.from(att.content || []),
            })),
        })
      }
    } finally {
      lock.release()
    }
  } finally {
    try { await client.logout() } catch { /* ignore */ }
  }

  return out
}

export async function markSalesInboxUidsSeen(config: SalesImapConfig, uids: number[]): Promise<void> {
  const unique = [...new Set(uids.filter(n => n > 0))]
  if (unique.length === 0) return
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.pass },
    logger: false,
  })
  try {
    await client.connect()
    const lock = await client.getMailboxLock(config.mailbox)
    try {
      await client.messageFlagsAdd(unique, ['\\Seen'], { uid: true })
    } finally {
      lock.release()
    }
  } finally {
    try { await client.logout() } catch { /* ignore */ }
  }
}
