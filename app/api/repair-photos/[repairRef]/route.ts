import { NextRequest, NextResponse } from 'next/server'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import { getServerSession } from '@/lib/auth/server'
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
    const state = await loadAppState()
    const photos = (state[stateKey(params.repairRef)] ?? []) as Photo[]
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
    const state = await loadAppState()
    const existing = (state[key] ?? []) as Photo[]
    const photo: Photo = {
      id: randomUUID(),
      url: body.url,
      name: body.name ?? '',
      uploaded_at: new Date().toISOString(),
    }
    await saveStoreKeys({ [key]: JSON.stringify([...existing, photo]) })
    return NextResponse.json({ photo }, { status: 201 })
  } catch (err) {
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
    const state = await loadAppState()
    const existing = (state[key] ?? []) as Photo[]
    await saveStoreKeys({ [key]: JSON.stringify(existing.filter(p => p.id !== body.id)) })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[repair-photos] DELETE error:', err)
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 })
  }
}
