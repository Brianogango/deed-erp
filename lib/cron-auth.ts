import type { NextRequest } from 'next/server'
import { timingSafeEqual } from 'crypto'

/** True when the request carries the CRON_SECRET (Authorization: Bearer … or x-cron-secret). */
export function cronAuthorized(req: NextRequest): boolean {
  const secret = (process.env.CRON_SECRET || '').trim()
  if (!secret) return false
  const header = (req.headers.get('authorization') || '').trim()
  const bearer = header.toLowerCase().startsWith('bearer ')
    ? header.slice(7).trim()
    : ''
  const alt = (req.headers.get('x-cron-secret') || '').trim()
  const provided = bearer || alt
  if (!provided || provided.length !== secret.length) return false
  try {
    return timingSafeEqual(Buffer.from(provided), Buffer.from(secret))
  } catch {
    return false
  }
}
