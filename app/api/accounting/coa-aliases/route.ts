import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { DEFAULT_COA_ALIASES, displayCodeFor, resolveLiveCode } from '@/lib/accounting/coa-alias'

export const dynamic = 'force-dynamic'

/**
 * CoA renumber = display alias map only. Never rewrites posted journal lines.
 */
export async function GET(request: NextRequest) {
  return withApiErrorHandling(async () => {
    await requireRole(['director', 'finance_officer', 'admin_officer'])
    const { searchParams } = new URL(request.url)
    const code = searchParams.get('code')
    let aliases = await prisma.accountAlias.findMany({ where: { isActive: true } })
    if (aliases.length === 0) {
      aliases = DEFAULT_COA_ALIASES.map(a => ({
        id: `seed-${a.liveCode}`,
        liveCode: a.liveCode,
        displayCode: a.displayCode,
        guideName: a.guideName || null,
        notes: 'default seed (not persisted)',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }))
    }
    if (code) {
      return NextResponse.json({
        ok: true,
        liveCode: resolveLiveCode(code, aliases),
        displayCode: displayCodeFor(resolveLiveCode(code, aliases), aliases),
      })
    }
    return NextResponse.json({
      ok: true,
      aliases,
      note: 'Aliases are display/resolution only — posted history keeps live codes.',
    })
  })
}

export async function POST(request: NextRequest) {
  return withApiErrorHandling(async () => {
    await requireRole(['director'])
    const body = await request.json().catch(() => ({}))
    if (body.action === 'seed_defaults') {
      for (const a of DEFAULT_COA_ALIASES) {
        await prisma.accountAlias.upsert({
          where: { liveCode: a.liveCode },
          create: {
            liveCode: a.liveCode,
            displayCode: a.displayCode,
            guideName: a.guideName || null,
          },
          update: {
            displayCode: a.displayCode,
            guideName: a.guideName || null,
            isActive: true,
          },
        })
      }
      const aliases = await prisma.accountAlias.findMany({ orderBy: { liveCode: 'asc' } })
      return NextResponse.json({ ok: true, aliases })
    }

    const liveCode = String(body.liveCode || '').trim()
    const displayCode = String(body.displayCode || '').trim()
    if (!liveCode || !displayCode) {
      return NextResponse.json({ error: 'liveCode and displayCode required' }, { status: 400 })
    }
    const row = await prisma.accountAlias.upsert({
      where: { liveCode },
      create: {
        liveCode,
        displayCode,
        guideName: body.guideName ? String(body.guideName) : null,
        notes: body.notes ? String(body.notes) : null,
      },
      update: {
        displayCode,
        guideName: body.guideName ? String(body.guideName) : null,
        notes: body.notes ? String(body.notes) : null,
        isActive: true,
      },
    })
    return NextResponse.json({ ok: true, alias: row }, { status: 201 })
  })
}
