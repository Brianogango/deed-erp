/**
 * POST { fileBase64, mimeType } — read a supplier PDF / photo into draft rows
 * for the Inbound import (lib/inventory/inbound-import.ts). Nothing is saved.
 */
import { NextResponse } from 'next/server'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { readDeliveryDocument } from '@/lib/inventory/document-extract.server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

const ROLES = ['director', 'admin_officer', 'inventory_officer']
const TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
const MAX_BYTES = 15 * 1024 * 1024

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    await requireRole(ROLES)
    const body = await request.json().catch(() => ({})) as { fileBase64?: unknown; mimeType?: unknown }
    const mimeType = String(body.mimeType ?? '')
    const base64 = String(body.fileBase64 ?? '').replace(/^data:[^,]+,/, '').replace(/\s+/g, '')
    if (!TYPES.has(mimeType)) return NextResponse.json({ error: 'Upload a PDF, JPG, PNG or WebP file' }, { status: 415 })
    if (!base64) return NextResponse.json({ error: 'The file is empty' }, { status: 400 })
    if (Math.floor(base64.length * 3 / 4) > MAX_BYTES) return NextResponse.json({ error: 'The file is larger than 15 MB' }, { status: 413 })
    const result = await readDeliveryDocument(base64, mimeType)
    if (!result.rows.length) return NextResponse.json({ error: 'No product lines were found in the document' }, { status: 422 })
    return NextResponse.json(result)
  })
}
