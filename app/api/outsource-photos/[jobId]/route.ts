import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getServerSession } from '@/lib/auth/server'
import { hasModuleAccess } from '@/lib/auth/access'
import { canWriteStoreKey } from '@/lib/auth/store-write-policy'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import { ImageNormalizationError, normalizeUploadedRepairPhoto } from '@/lib/server-image-normalization'

/**
 * Photos of a machine when it went to a repair vendor and when it came back.
 * Staff only: unlike repair photos these are never shown on the customer
 * portal. Stored as a blob per job (outsource_photos_<job id>).
 */

type Stage = 'sent' | 'returned'
type StoredPhoto = { id: string; url: string; name: string; stage: Stage; uploaded_at: string; by?: string }

const JOB_ID = /^[A-Za-z0-9_-]{1,64}$/
const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_PHOTOS_PER_JOB = 12

const keyFor = (jobId: string) => `outsource_photos_${jobId}`

async function staff() {
  const session = await getServerSession()
  if (!session) return null
  const user = session.user as any
  return hasModuleAccess(user, 'outsource') || hasModuleAccess(user, 'repair') ? user : null
}

async function load(jobId: string): Promise<StoredPhoto[]> {
  const state = await loadAppState([keyFor(jobId)])
  const rows = state[keyFor(jobId)]
  return Array.isArray(rows) ? rows as StoredPhoto[] : []
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params
  if (!JOB_ID.test(jobId)) return NextResponse.json({ error: 'Invalid job' }, { status: 400 })
  if (!await staff()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const photos = await load(jobId)

  const photoId = req.nextUrl.searchParams.get('photo')
  if (photoId) {
    const photo = photos.find(p => p.id === photoId)
    const match = photo?.url.match(/^data:([^;,]+);base64,([\s\S]*)$/)
    if (!match || !PHOTO_TYPES.has(match[1].toLowerCase())) return NextResponse.json({ error: 'Photo not found' }, { status: 404 })
    const buffer = Buffer.from(match[2], 'base64')
    return new NextResponse(buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': match[1],
        'Cache-Control': 'private, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  }

  return NextResponse.json({
    photos: photos.map(({ url: _url, ...rest }) => ({ ...rest, url: `/api/outsource-photos/${jobId}?photo=${encodeURIComponent(rest.id)}` })),
  })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params
  if (!JOB_ID.test(jobId)) return NextResponse.json({ error: 'Invalid job' }, { status: 400 })
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  // Whoever may save outsource jobs may add their photos.
  if (!canWriteStoreKey(user, 'deed_outsourceJobs')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: { url?: string; name?: string; stage?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  if (!body.url) return NextResponse.json({ error: 'url is required' }, { status: 400 })
  const stage: Stage = body.stage === 'returned' ? 'returned' : 'sent'

  try {
    const existing = await load(jobId)
    if (existing.length >= MAX_PHOTOS_PER_JOB) {
      return NextResponse.json({ error: `A job keeps up to ${MAX_PHOTOS_PER_JOB} photos` }, { status: 409 })
    }
    const normalized = await normalizeUploadedRepairPhoto(body.url)
    const photo: StoredPhoto = {
      id: randomUUID(),
      url: normalized.dataUrl,
      name: String(body.name ?? '').slice(0, 120),
      stage,
      uploaded_at: new Date().toISOString(),
      by: String(user?.name ?? ''),
    }
    await saveStoreKeys({ [keyFor(jobId)]: JSON.stringify([...existing, photo]) })
    const { url: _url, ...rest } = photo
    return NextResponse.json({ photo: { ...rest, url: `/api/outsource-photos/${jobId}?photo=${encodeURIComponent(photo.id)}` } }, { status: 201 })
  } catch (err) {
    if (err instanceof ImageNormalizationError) return NextResponse.json({ error: err.message }, { status: err.status })
    console.error('[outsource-photos] POST error:', err)
    return NextResponse.json({ error: 'Could not save the photo' }, { status: 500 })
  }
}
