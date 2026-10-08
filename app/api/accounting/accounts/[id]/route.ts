import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { withApiErrorHandling } from '@/lib/auth/api'
import { notifyStoreKeysChanged } from '@/lib/server-store'
import { requireAccountEditor, accountBodySchema, accountData, findAccountByScreenId, toScreenAccount } from '@/lib/account-read-model.server'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

/**
 * Edit an account. The id is the one the screen shows (screen_id or the table
 * id). An account only the frozen screen copy listed is added to the table
 * on its first edit, keeping its id.
 */
export async function PUT(request: NextRequest, { params }: Ctx) {
  return withApiErrorHandling(async () => {
    await requireAccountEditor()
    const { id } = await params
    const raw = await request.json().catch(() => null)
    const existing = await findAccountByScreenId(id)
    const parsed = existing
      ? accountBodySchema.partial().safeParse(raw)
      : accountBodySchema.safeParse(raw)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid account' }, { status: 400 })
    }
    const body = parsed.data
    const { id: _ignored, ...fields } = body
    const target = existing ?? (body.code ? await prisma.accountCode.findUnique({ where: { code: body.code } }) : null)
    if (body.code && body.code !== target?.code) {
      const clash = await prisma.accountCode.findUnique({ where: { code: body.code }, select: { id: true } })
      if (clash) return NextResponse.json({ error: `Code ${body.code} already exists` }, { status: 409 })
      if (target && await prisma.journalEntryLine.count({ where: { accountId: target.id } })) {
        return NextResponse.json({ error: `${target.code} has ledger entries — its code cannot change` }, { status: 409 })
      }
    }
    const saved = target
      ? await prisma.accountCode.update({
          where: { id: target.id },
          data: { ...accountData(fields), ...(target.screenId ? {} : { screenId: id }) },
        })
      : await prisma.accountCode.create({
          data: {
            ...(accountData(fields) as any),
            code: body.code!,
            name: body.name!,
            accountType: body.type!,
            screenId: id,
          },
        })
    await notifyStoreKeysChanged(['deed_accounts'])
    return NextResponse.json(toScreenAccount(saved))
  })
}
