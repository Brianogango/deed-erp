import { NextRequest, NextResponse } from 'next/server'
import sharp from 'sharp'
import { loadAppState } from '@/lib/server-store'
import type { RepairOrder } from '@/lib/repair-types'
import { guardPortalRoute } from '@/lib/portal/portal-guard.server'
import { repairAttachmentReadAllowed } from '@/lib/repair-attachment-access'

type RepairPhoto = { url?: string; name?: string; date?: string; uploaded_at?: string }

// Only raster images are served; a stored data URL of any other type (HTML,
// SVG) would otherwise run as a page on this origin.
const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif', 'image/avif'])

const MAX_DISPLAY_WIDTH = 1400
const DISPLAY_JPEG_QUALITY = 78

function photoKey(ref: string) {
  return `repair_photos_${decodeURIComponent(ref).toUpperCase().replace(/\//g, '_')}`
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

async function optimizeForDisplay(buffer: Buffer, contentType: string): Promise<{ contentType: string; buffer: Buffer }> {
  if (!contentType.startsWith('image/')) return { contentType, buffer }

  try {
    const image = sharp(buffer, { failOn: 'none' }).rotate()
    const metadata = await image.metadata()
    const shouldResize = typeof metadata.width === 'number' && metadata.width > MAX_DISPLAY_WIDTH

    const optimized = await image
      .resize(shouldResize ? { width: MAX_DISPLAY_WIDTH, withoutEnlargement: true } : undefined)
      .jpeg({ quality: DISPLAY_JPEG_QUALITY, mozjpeg: true })
      .toBuffer()

    if (optimized.length > 0 && optimized.length < buffer.length) {
      return { contentType: 'image/jpeg', buffer: optimized }
    }
  } catch (err) {
    console.warn('[repair photo GET] Falling back to original image after optimization error:', err)
  }

  return { contentType, buffer }
}

async function loadPhotos(ref: string): Promise<RepairPhoto[]> {
  const decoded = decodeURIComponent(ref)
  const key = photoKey(decoded)
  const state = await loadAppState([key, 'deed_repairs_v2', 'deed_repairs'])

  const stored = state[key]
  if (Array.isArray(stored) && stored.length > 0) return stored as RepairPhoto[]

  const repairs = (Array.isArray(state['deed_repairs_v2']) ? state['deed_repairs_v2'] : state['deed_repairs']) as RepairOrder[] | undefined
  const repair = repairs?.find(r => r.ref?.toLowerCase() === decoded.toLowerCase())
  return Array.isArray(repair?.issuePhotos) ? repair.issuePhotos as RepairPhoto[] : []
}

async function handleGET(
  req: NextRequest,
  { params }: { params: Promise<{ ref: string; index: string }> }
) {
  const resolvedParams = await params
  // The segment accepts either a numeric position or a photo id (uuid) —
  // ids stay stable when photos are deleted, positions do not.
  const rawKey = decodeURIComponent(resolvedParams.index)
  const index = /^\d+$/.test(rawKey) ? Number.parseInt(rawKey, 10) : -1
  if (index < 0 && !rawKey) {
    return NextResponse.json({ error: 'Invalid photo reference' }, { status: 400 })
  }

  // Same check as the invoice and receipt PDFs: a staff session, or the
  // phone number on the repair (?phone=). Repair refs are sequential.
  if (!await repairAttachmentReadAllowed(req, decodeURIComponent(resolvedParams.ref))) {
    return NextResponse.json({ error: 'Enter the phone number on this repair to view it.' }, { status: 403 })
  }
  try {
    const photos = await loadPhotos(resolvedParams.ref)
    const photo = index >= 0 ? photos[index] : photos.find(p => (p as any).id === rawKey)
    const url = photo?.url
    if (!url) return NextResponse.json({ error: 'Photo not found' }, { status: 404 })

    if (/^https?:\/\//i.test(url)) {
      return NextResponse.redirect(url, 302)
    }

    const parsed = parseDataUrl(url)
    if (!parsed || !PHOTO_TYPES.has(parsed.contentType.toLowerCase())) return NextResponse.json({ error: 'Unsupported photo format' }, { status: 415 })

    const original = req.nextUrl.searchParams.get('original') === '1'
    const payload = original ? parsed : await optimizeForDisplay(parsed.buffer, parsed.contentType)

    const body = payload.buffer.buffer.slice(payload.buffer.byteOffset, payload.buffer.byteOffset + payload.buffer.byteLength)
    return new NextResponse(body as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': payload.contentType,
        // Private: the response depends on who is asking.
        'Cache-Control': 'private, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
        'Content-Length': String(payload.buffer.length),
        'Vary': 'Accept',
      },
    })
  } catch (err) {
    console.error('[repair photo GET] Error:', err)
    return NextResponse.json({ error: 'Failed to load photo' }, { status: 500 })
  }
}

export const GET = guardPortalRoute('photos', 1500, handleGET)
