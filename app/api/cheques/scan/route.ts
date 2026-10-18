/**
 * POST { imageBase64, mimeType } — read a photo of a cheque into draft fields.
 * Nothing is saved; the person checks the fields and then adds the cheque.
 */
import { NextResponse } from 'next/server'
import { requireCan, withApiErrorHandling } from '@/lib/auth/api'
import { validateFileContent } from '@/lib/file-validation'
import { readChequeImage } from '@/lib/cheques/cheque-extract.server'
import { CHEQUE_IMAGE_MAX_BYTES, CHEQUE_IMAGE_TYPES } from '@/lib/cheques/cheque-store.server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    await requireCan('accounting.cheques.manage')
    const body = await request.json().catch(() => ({})) as { imageBase64?: unknown; mimeType?: unknown }
    const mimeType = String(body.mimeType ?? '').toLowerCase()
    const base64 = String(body.imageBase64 ?? '').replace(/^data:[^,]+,/, '').replace(/\s+/g, '')
    if (!CHEQUE_IMAGE_TYPES.has(mimeType)) return NextResponse.json({ error: 'Use a JPG, PNG or WebP photo of the cheque' }, { status: 415 })
    if (!base64) return NextResponse.json({ error: 'The photo is empty' }, { status: 400 })
    const buffer = Buffer.from(base64, 'base64')
    if (buffer.length > CHEQUE_IMAGE_MAX_BYTES) return NextResponse.json({ error: 'The photo is larger than 8 MB' }, { status: 413 })
    const check = validateFileContent(buffer, mimeType)
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: 415 })
    return NextResponse.json(await readChequeImage(base64, mimeType))
  })
}
