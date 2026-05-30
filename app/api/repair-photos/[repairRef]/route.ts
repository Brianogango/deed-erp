import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/auth/db'
import { getServerSession } from '@/lib/auth/server'

async function ensureTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS repair_photos (
      id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      repair_ref TEXT NOT NULL,
      url        TEXT NOT NULL,
      name       TEXT NOT NULL DEFAULT '',
      uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `
  await sql`
    CREATE INDEX IF NOT EXISTS idx_repair_photos_ref ON repair_photos (repair_ref)
  `
}

function normaliseRef(ref: string) {
  return decodeURIComponent(ref).toUpperCase()
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { repairRef: string } }
) {
  try {
    await ensureTable()
    const ref = normaliseRef(params.repairRef)
    const { rows } = await sql`
      SELECT id, repair_ref, name, url, uploaded_at
      FROM repair_photos
      WHERE UPPER(repair_ref) = ${ref}
      ORDER BY uploaded_at ASC
    `
    return NextResponse.json({ photos: rows })
  } catch (err) {
    console.error('[repair-photos] GET error:', err)
    return NextResponse.json({ photos: [] })
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { repairRef: string } }
) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { url?: string; name?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  if (!body.url) return NextResponse.json({ error: 'url is required' }, { status: 400 })

  try {
    await ensureTable()
    const ref = normaliseRef(params.repairRef)
    const { rows } = await sql`
      INSERT INTO repair_photos (repair_ref, url, name)
      VALUES (${ref}, ${body.url}, ${body.name ?? ''})
      RETURNING id, repair_ref, name, url, uploaded_at
    `
    return NextResponse.json({ photo: rows[0] }, { status: 201 })
  } catch (err) {
    console.error('[repair-photos] POST error:', err)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { repairRef: string } }
) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { id?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  if (!body.id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  try {
    await ensureTable()
    const ref = normaliseRef(params.repairRef)
    await sql`
      DELETE FROM repair_photos WHERE id = ${body.id} AND UPPER(repair_ref) = ${ref}
    `
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[repair-photos] DELETE error:', err)
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 })
  }
}
