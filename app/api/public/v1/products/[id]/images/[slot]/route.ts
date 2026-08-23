import { NextResponse } from 'next/server'
import { partnerCorsHeaders } from '@/lib/partner-api'
import { loadProductPhotos } from '@/lib/product-images.server'
import { parseProductImageSlot } from '@/lib/product-images'
import { matchCatalogPhotoPack } from '@/lib/catalog-photos'
import { readCatalogPhotoFile } from '@/lib/catalog-photos.server'
import prisma from '@/lib/prisma'

export const dynamic = 'force-dynamic'

function parseDataUrl(dataUrl: string): { contentType: string; buffer: Buffer } | null {
  const match = dataUrl.match(/^data:([^;,]+);base64,([\s\S]*)$/)
  if (!match) return null
  try {
    return { contentType: match[1], buffer: Buffer.from(match[2], 'base64') }
  } catch {
    return null
  }
}

export async function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: partnerCorsHeaders(request) })
}

export async function GET(
  request: Request,
  { params }: { params: { id: string; slot: string } },
) {
  const slot = parseProductImageSlot(params.slot)
  if (!slot) {
    return NextResponse.json({ error: 'Not found' }, { status: 404, headers: partnerCorsHeaders(request) })
  }

  const photos = await loadProductPhotos(params.id)
  const uploaded = photos.find(p => p.slot === slot)
  if (uploaded) {
    const parsed = parseDataUrl(uploaded.dataUrl)
    if (parsed) {
      return new NextResponse(new Uint8Array(parsed.buffer), {
        status: 200,
        headers: {
          ...partnerCorsHeaders(request),
          'Content-Type': parsed.contentType || 'image/jpeg',
          'Cache-Control': 'public, max-age=3600',
        },
      })
    }
  }

  const product = await prisma.product.findUnique({
    where: { id: params.id },
    select: { name: true, sku: true },
  }).catch(() => null)
  const pack = product ? matchCatalogPhotoPack(product.name, product.sku) : null
  const file = pack ? await readCatalogPhotoFile(pack.id, slot) : null
  if (file) {
    return new NextResponse(new Uint8Array(file.buffer), {
      status: 200,
      headers: {
        ...partnerCorsHeaders(request),
        'Content-Type': file.contentType,
        'Cache-Control': 'public, max-age=86400',
      },
    })
  }

  return NextResponse.json({ error: 'Not found' }, { status: 404, headers: partnerCorsHeaders(request) })
}
