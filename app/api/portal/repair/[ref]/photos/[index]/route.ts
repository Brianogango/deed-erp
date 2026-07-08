import { NextRequest, NextResponse } from 'next/server'
import sharp from 'sharp'
import { loadAppState } from '@/lib/server-store'
import type { RepairOrder } from '@/lib/repair-types'

type RepairPhoto = { url?: string; name?: string; date?: string; uploaded_at?: string }

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

export async function GET(
  req: NextRequest,
  { params }: { params: { ref: string; index: string } }
) {
  // The segment accepts either a numeric position or a photo id (uuid) —
  // ids stay stable when photos are deleted, positions do not.
  const rawKey = decodeURIComponent(params.index)
  const index = /^\d+$/.test(rawKey) ? Number.parseInt(rawKey, 10) : -1
  if (index < 0 && !rawKey) {
    return NextResponse.json({ error: 'Invalid photo reference' }, { status: 400 })
  }

  try {
    const photos = await loadPhotos(params.ref)
    const photo = index >= 0 ? photos[index] : photos.find(p => (p as any).id === rawKey)
    const url = photo?.url
    if (!url) return NextResponse.json({ error: 'Photo not found' }, { status: 404 })

    if (/^https?:\/\//i.test(url)) {
      return NextResponse.redirect(url, 302)
    }

    const parsed = parseDataUrl(url)
    if (!parsed) return NextResponse.json({ error: 'Unsupported photo format' }, { status: 415 })

    const original = req.nextUrl.searchParams.get('original') === '1'
    const payload = original ? parsed : await optimizeForDisplay(parsed.buffer, parsed.contentType)

    const body = payload.buffer.buffer.slice(payload.buffer.byteOffset, payload.buffer.byteOffset + payload.buffer.byteLength)
    return new NextResponse(body as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': payload.contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Content-Length': String(payload.buffer.length),
        'Vary': 'Accept',
      },
    })
  } catch (err) {
    console.error('[repair photo GET] Error:', err)
    return NextResponse.json({ error: 'Failed to load photo' }, { status: 500 })
  }
}
