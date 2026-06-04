import { NextRequest, NextResponse } from 'next/server'
import { loadAppState } from '@/lib/server-store'
import type { RepairOrder } from '@/lib/repair-types'

type RepairPhoto = { url?: string; name?: string; date?: string; uploaded_at?: string }

function photoKey(ref: string) {
  return `repair_photos_${decodeURIComponent(ref).toUpperCase().replace(/\//g, '_')}`
}

function parseDataUrl(dataUrl: string): { contentType: string; buffer: Buffer } | null {
  const match = dataUrl.match(/^data:([^;,]+);base64,(.*)$/s)
  if (!match) return null
  try {
    return { contentType: match[1] || 'application/octet-stream', buffer: Buffer.from(match[2], 'base64') }
  } catch {
    return null
  }
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
  _req: NextRequest,
  { params }: { params: { ref: string; index: string } }
) {
  const index = Number.parseInt(params.index, 10)
  if (!Number.isInteger(index) || index < 0) {
    return NextResponse.json({ error: 'Invalid photo index' }, { status: 400 })
  }

  try {
    const photos = await loadPhotos(params.ref)
    const photo = photos[index]
    const url = photo?.url
    if (!url) return NextResponse.json({ error: 'Photo not found' }, { status: 404 })

    if (/^https?:\/\//i.test(url)) {
      return NextResponse.redirect(url, 302)
    }

    const parsed = parseDataUrl(url)
    if (!parsed) return NextResponse.json({ error: 'Unsupported photo format' }, { status: 415 })

    return new NextResponse(parsed.buffer, {
      status: 200,
      headers: {
        'Content-Type': parsed.contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Content-Length': String(parsed.buffer.length),
      },
    })
  } catch (err) {
    console.error('[repair photo GET] Error:', err)
    return NextResponse.json({ error: 'Failed to load photo' }, { status: 500 })
  }
}
