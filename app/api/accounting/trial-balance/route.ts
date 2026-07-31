import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'

export const dynamic = 'force-dynamic'

/**
 * Read-only KES trial balance from posted journal_entry_lines.
 * Does not mix AccountCode.balance seed figures. No FX.
 */
export async function GET(request: NextRequest) {
  return withApiErrorHandling(async () => {
    await requireRole(['director', 'finance_officer', 'admin_officer'])
    const { searchParams } = new URL(request.url)
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')

    const entryWhere: any = { isPosted: true, isReversed: false }
    if (dateFrom || dateTo) {
      entryWhere.entryDate = {}
      if (dateFrom) entryWhere.entryDate.gte = new Date(`${dateFrom}T00:00:00Z`)
      if (dateTo) entryWhere.entryDate.lte = new Date(`${dateTo}T23:59:59Z`)
    }

    const lines = await prisma.journalEntryLine.findMany({
      where: { journalEntry: entryWhere },
      select: {
        accountId: true,
        accountLabel: true,
        debit: true,
        credit: true,
        account: { select: { code: true, name: true, accountType: true, accountGroup: true } },
      },
    })

    type Agg = {
      id: string
      code: string
      name: string
      type: string
      group: string
      debit: number
      credit: number
    }
    const map = new Map<string, Agg>()

    for (const line of lines) {
      const code = line.account?.code || (line.accountLabel.match(/^(\d{3,6})\b/)?.[1] ?? 'UNKNOWN')
      const name = line.account?.name || (line.accountLabel.includes(' - ')
        ? line.accountLabel.split(' - ').slice(1).join(' - ')
        : line.accountLabel)
      const type = line.account?.accountType || 'asset'
      const group = line.account?.accountGroup || ''
      const key = code
      const row = map.get(key) || {
        id: key,
        code,
        name,
        type,
        group,
        debit: 0,
        credit: 0,
      }
      row.debit += Number(line.debit || 0)
      row.credit += Number(line.credit || 0)
      map.set(key, row)
    }

    const rows = Array.from(map.values())
      .map(r => {
        const net = Math.round((r.debit - r.credit) * 100) / 100
        return {
          id: r.id,
          code: r.code,
          name: r.name,
          type: r.type,
          group: r.group,
          debit: net > 0 ? net : 0,
          credit: net < 0 ? Math.abs(net) : 0,
          grossDebit: Math.round(r.debit * 100) / 100,
          grossCredit: Math.round(r.credit * 100) / 100,
        }
      })
      .sort((a, b) => a.code.localeCompare(b.code))

    const totals = rows.reduce(
      (acc, r) => ({ debit: acc.debit + r.debit, credit: acc.credit + r.credit }),
      { debit: 0, credit: 0 },
    )

    return NextResponse.json({
      currency: 'KES',
      rows,
      totals: {
        debit: Math.round(totals.debit * 100) / 100,
        credit: Math.round(totals.credit * 100) / 100,
      },
      balanced: Math.abs(totals.debit - totals.credit) < 0.02,
    })
  })
}
