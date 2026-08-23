import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import {
  ImageNormalizationError,
  deleteProductPhoto,
  loadProductPhotos,
  saveProductPhoto,
} from '@/lib/product-images.server'
import { parseProductImageSlot, productImagePublicPath, productImageRole } from '@/lib/product-images'
import { matchCatalogPhotoPack } from '@/lib/catalog-photos'
import { catalogPhotoPublicPath } from '@/lib/product-images'

const WRITE_ROLES = ['director', 'admin_officer', 'inventory_officer', 'technical_lead', 'finance_officer']

function photoPayload(productId: string, slot: 1 | 2, uploaded: boolean, packId?: string | null) {
  const url = uploaded
    ? productImagePublicPath(productId, slot)
    : packId
      ? catalogPhotoPublicPath(packId, slot)
      : null
  return { slot, role: productImageRole(slot), url, source: uploaded ? 'upload' : packId ? 'catalog' : null }
}

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    await requireRole(WRITE_ROLES)
    const product = await prisma.product.findUnique({
      where: { id: params.id },
      select: { id: true, name: true, sku: true },
    })
    if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    const photos = await loadProductPhotos(product.id)
    const uploaded = new Set(photos.map(p => p.slot))
    const pack = matchCatalogPhotoPack(product.name, product.sku)
    return NextResponse.json({
      images: [
        photoPayload(product.id, 1, uploaded.has(1), pack?.id),
        photoPayload(product.id, 2, uploaded.has(2), pack?.id),
      ],
    })
  })
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    await requireRole(WRITE_ROLES)
    const product = await prisma.product.findUnique({
      where: { id: params.id },
      select: { id: true },
    })
    if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

    let body: { slot?: unknown; dataUrl?: string }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    const slot = parseProductImageSlot(body.slot)
    if (!slot) return NextResponse.json({ error: 'slot must be 1 (hero) or 2 (detail)' }, { status: 400 })
    if (!body.dataUrl) return NextResponse.json({ error: 'dataUrl is required' }, { status: 400 })

    try {
      const { publicPath, photo } = await saveProductPhoto(product.id, slot, body.dataUrl)
      return NextResponse.json({
        image: {
          slot,
          role: photo.role,
          url: publicPath,
          source: 'upload',
          bytes: photo.bytes,
        },
      }, { status: 201 })
    } catch (err) {
      if (err instanceof ImageNormalizationError) {
        return NextResponse.json({ error: err.message }, { status: err.status })
      }
      throw err
    }
  })
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    await requireRole(WRITE_ROLES)
    const url = new URL(request.url)
    const slot = parseProductImageSlot(url.searchParams.get('slot'))
    if (!slot) return NextResponse.json({ error: 'slot must be 1 (hero) or 2 (detail)' }, { status: 400 })
    const product = await prisma.product.findUnique({ where: { id: params.id }, select: { id: true } })
    if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    await deleteProductPhoto(product.id, slot)
    return NextResponse.json({ ok: true })
  })
}
