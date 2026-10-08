import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { withApiErrorHandling } from '@/lib/auth/api'
import { notifyStoreKeysChanged } from '@/lib/server-store'
import { requireAccountEditor, accountBodySchema, accountData, toScreenAccount } from '@/lib/account-read-model.server'

export const dynamic = 'force-dynamic'

/** Add an account to the chart (account_codes). */
export async function POST(request: NextRequest) {
  return withApiErrorHandling(async () => {
    await requireAccountEditor()
    const parsed = accountBodySchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid account' }, { status: 400 })
    }
    const body = parsed.data
    if (await prisma.accountCode.findUnique({ where: { code: body.code }, select: { id: true } })) {
      return NextResponse.json({ error: `Code ${body.code} already exists` }, { status: 409 })
    }
    const created = await prisma.accountCode.create({
      data: {
        ...(accountData(body) as any),
        code: body.code,
        name: body.name,
        accountType: body.type,
        screenId: body.id ?? null,
      },
    })
    await notifyStoreKeysChanged(['deed_accounts'])
    return NextResponse.json(toScreenAccount(created), { status: 201 })
  })
}
