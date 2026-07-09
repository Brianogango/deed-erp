import { NextRequest, NextResponse } from 'next/server'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import { getServerSession } from '@/lib/auth/server'
import { ImageNormalizationError, normalizeUploadedRepairPhoto } from '@/lib/server-image-normalization'
import { randomUUID } from 'crypto'

type Photo = { id: string; url: string; name: string; uploaded_at: string }

function stateKey(ref: string) {
  return `repair_photos_${decodeURIComponent(ref).toUpperCase().replace(/\//g, '_')}`
}

// Public — called by the client portal to show photos
export async function GET(
  _req: NextRequest,
  { params }: { params: { repairRef: string } }
) {
  try {
    const key = stateKey(params.repairRef)
    const state = await loadAppState([key])
    const photos = (state[key] ?? []) as Photo[]
    return NextResponse.json({ photos })
  } catch {
    return NextResponse.json({ photos: [] })
  }
}

// Authenticated — called by the ERP when staff upload a photo
export async function POST(
  req: NextRequest,
  { params }: { params: { repairRef: string } }
) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { url?: string; name?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!body.url) return NextResponse.json({ error: 'url is required' }, { status: 400 })

  try {
    const key = stateKey(params.repairRef)
    const state = await loadAppState([key])
    const existing = (state[key] ?? []) as Photo[]
    const photo: Photo = {
      id: randomUUID(),
      url: '',
      name: body.name ?? '',
      uploaded_at: new Date().toISOString(),
    }

    const normalized = await normalizeUploadedRepairPhoto(body.url)
    photo.url = normalized.dataUrl

    await saveStoreKeys({ [key]: JSON.stringify([...existing, photo]) })
    // Return a lightweight serving URL — NOT the base64 payload — so the
    // caller never embeds megabytes of image data back into the repair record.
    const servingUrl = `/api/portal/repair/${encodeURIComponent(params.repairRef)}/photos/${encodeURIComponent(photo.id)}`
    return NextResponse.json({
      photo: { ...photo, url: servingUrl },
      normalized: {
        contentType: normalized.contentType,
        bytes: normalized.bytes,
        originalBytes: normalized.originalBytes,
        quality: normalized.quality,
      },
    }, { status: 201 })
  } catch (err) {
    if (err instanceof ImageNormalizationError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    console.error('[repair-photos] POST error:', err)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}

// Authenticated — called by the ERP when staff delete a photo
export async function DELETE(
  req: NextRequest,
  { params }: { params: { repairRef: string } }
) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { id?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!body.id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  try {
    const key = stateKey(params.repairRef)
    const state = await loadAppState([key])
    const existing = (state[key] ?? []) as Photo[]
    await saveStoreKeys({ [key]: JSON.stringify(existing.filter(p => p.id !== body.id)) })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[repair-photos] DELETE error:', err)
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 })
  }
}
