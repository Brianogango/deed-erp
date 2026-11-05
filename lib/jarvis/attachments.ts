import type { JarvisAttachment } from './provider/types'

export const DIA_ATTACHMENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'] as const
export const DIA_MAX_ATTACHMENTS = 4
/** Base64 characters per file (about 7.5 MB of data). */
export const DIA_MAX_ATTACHMENT_CHARS = 10_000_000
const MAX_TOTAL_CHARS = 24_000_000

/** Photos and PDFs sent with a DIA message, checked before they reach the model. */
export function parseDiaAttachments(raw: unknown): { ok: true; attachments: JarvisAttachment[] } | { ok: false; error: string } {
  if (raw == null) return { ok: true, attachments: [] }
  if (!Array.isArray(raw)) return { ok: false, error: 'attachments must be a list' }
  if (raw.length > DIA_MAX_ATTACHMENTS) return { ok: false, error: `Attach up to ${DIA_MAX_ATTACHMENTS} files at a time` }
  const out: JarvisAttachment[] = []
  let total = 0
  for (const item of raw) {
    const a = item as Record<string, unknown>
    const mediaType = String(a?.mediaType ?? '')
    if (!(DIA_ATTACHMENT_TYPES as readonly string[]).includes(mediaType)) {
      return { ok: false, error: 'Only photos (JPG, PNG, WebP, GIF) and PDFs can be attached' }
    }
    const data = String(a?.data ?? '').replace(/^data:[^,]*,/, '').replace(/\s+/g, '')
    if (!data || !/^[A-Za-z0-9+/]+=*$/.test(data)) return { ok: false, error: 'An attachment could not be read' }
    if (data.length > DIA_MAX_ATTACHMENT_CHARS) return { ok: false, error: 'Each file must be under 7 MB' }
    total += data.length
    if (total > MAX_TOTAL_CHARS) return { ok: false, error: 'The files together are too large — send fewer at a time' }
    const name = String(a?.name ?? 'attachment').replace(/[\r\n[\]]/g, ' ').trim().slice(0, 120) || 'attachment'
    out.push({ name, mediaType: mediaType as JarvisAttachment['mediaType'], data })
  }
  return { ok: true, attachments: out }
}
