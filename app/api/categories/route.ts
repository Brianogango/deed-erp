import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { ALL_CATEGORIES } from '@/lib/product-categories'

export const dynamic = 'force-dynamic'

const WRITE_ROLES = ['director', 'admin_officer', 'finance_officer']

function asRate(value: unknown): number | null {
  if (value === '' || value == null) return null
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return null
  if (n === 0) return 0
  return Math.round(n * 100) / 100
}

export async function GET() {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const rows = await prisma.category.findMany({
      select: { id: true, name: true, commissionRatePercent: true, isActive: true },
      orderBy: { name: 'asc' },
    })
    const byName = new Map(rows.map(row => [row.name.trim().toLowerCase(), row]))
    const items: Array<{ id: string | null; name: string; commissionRatePercent: number | null }> = ALL_CATEGORIES.map(name => {
      const row = byName.get(name.toLowerCase())
      return {
        id: row?.id ?? null,
        name,
        commissionRatePercent: row?.commissionRatePercent != null ? Number(row.commissionRatePercent) : null,
      }
    })
    for (const row of rows) {
      if (ALL_CATEGORIES.some(name => name.toLowerCase() === row.name.trim().toLowerCase())) continue
      items.push({
        id: row.id,
        name: row.name,
        commissionRatePercent: row.commissionRatePercent != null ? Number(row.commissionRatePercent) : null,
      })
    }
    return NextResponse.json({ items })
  })
}

export async function PUT(request: Request) {
  return withApiErrorHandling(async () => {
    await requireRole(WRITE_ROLES)
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    const rawItems = Array.isArray((body as { items?: unknown })?.items)
      ? (body as { items: Array<{ name?: string; commissionRatePercent?: unknown }> }).items
      : []
    if (rawItems.length === 0) {
      return NextResponse.json({ error: 'No category rates to save' }, { status: 400 })
    }

    const saved = []
    for (const raw of rawItems) {
      const name = String(raw?.name || '').trim()
      if (!name) continue
      const rate = asRate(raw.commissionRatePercent)
      const existing = await prisma.category.findFirst({
        where: { name: { equals: name, mode: 'insensitive' } },
        select: { id: true },
      })
      const row = existing
        ? await prisma.category.update({
            where: { id: existing.id },
            data: { commissionRatePercent: rate },
            select: { id: true, name: true, commissionRatePercent: true },
          })
        : await prisma.category.create({
            data: { name, isActive: true, commissionRatePercent: rate },
            select: { id: true, name: true, commissionRatePercent: true },
          })
      saved.push({
        id: row.id,
        name: row.name,
        commissionRatePercent: row.commissionRatePercent != null ? Number(row.commissionRatePercent) : null,
      })
    }

    return NextResponse.json({ items: saved })
  })
}
