import { NextResponse } from 'next/server'
import { partnerCorsHeaders } from '@/lib/partner-api'
import { parseProductImageSlot } from '@/lib/product-images'
import { CATALOG_PHOTO_PACKS } from '@/lib/catalog-photos'
import { readCatalogPhotoFile } from '@/lib/catalog-photos.server'

export const dynamic = 'force-dynamic'

export async function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: partnerCorsHeaders(request) })
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ packId: string; slot: string }> },
) {
  const resolvedParams = await params
  const slot = parseProductImageSlot(resolvedParams.slot)
  const pack = CATALOG_PHOTO_PACKS.find(p => p.id === resolvedParams.packId)
  if (!slot || !pack) {
    return NextResponse.json({ error: 'Not found' }, { status: 404, headers: partnerCorsHeaders(request) })
  }
  const file = await readCatalogPhotoFile(pack.id, slot)
  if (!file) {
    return NextResponse.json({ error: 'Not found' }, { status: 404, headers: partnerCorsHeaders(request) })
  }
  return new NextResponse(new Uint8Array(file.buffer), {
    status: 200,
    headers: {
      ...partnerCorsHeaders(request),
      'Content-Type': file.contentType,
      'Cache-Control': 'public, max-age=86400',
    },
  })
}
