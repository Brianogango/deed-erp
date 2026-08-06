import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { loadAppState } from '@/lib/server-store'
import { IMMUTABLE_AUDIT_KEY, type StoreAuditEntry } from '@/lib/store-audit'
import { queryCombinedAudit, type CombinedAuditRow } from '@/lib/audit-archive'

function matchesQuery(row: CombinedAuditRow, q: string): boolean {
  if (!q) return true
  const hay = [
    row.id,
    row.at,
    row.actor?.username,
    row.actor?.name,
    row.actor?.role,
    ...(row.savedKeys ?? []),
    ...(row.skippedKeys ?? []),
    ...(row.deniedKeys ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return hay.includes(q)
}

/**
 * Director-only combined audit search (live timeline + archive).
 * GET /api/admin/audit?from=&to=&q=&limit=&offset=&format=csv
 */
export async function GET(request: NextRequest) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'director') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = request.nextUrl
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  const q = (searchParams.get('q') ?? '').trim().toLowerCase()
  const limit = Number(searchParams.get('limit') ?? 100)
  const offset = Number(searchParams.get('offset') ?? 0)
  const format = searchParams.get('format')

  const state = await loadAppState([IMMUTABLE_AUDIT_KEY])
  const live = Array.isArray(state[IMMUTABLE_AUDIT_KEY])
    ? (state[IMMUTABLE_AUDIT_KEY] as StoreAuditEntry[])
    : []

  const liveRows: CombinedAuditRow[] = live
    .map(entry => ({
      id: entry.id,
      at: entry.at,
      source: 'live' as const,
      actor: entry.actor,
      savedKeys: entry.savedKeys,
      skippedKeys: entry.skippedKeys,
      deniedKeys: entry.deniedKeys,
      rejectedPostedInvoiceEdits: entry.rejectedPostedInvoiceEdits,
      payload: entry,
    }))
    .filter(row => {
      if (from && row.at < from) return false
      if (to && row.at > to) return false
      return matchesQuery(row, q)
    })
    .reverse()

  let archiveRows: CombinedAuditRow[] = []
  let archiveTotal = 0
  try {
    const archived = await queryCombinedAudit({ from, to, q, limit: 2000, offset: 0 })
    archiveRows = archived.rows
    archiveTotal = archived.total
  } catch (err) {
    console.error('[admin/audit] archive query failed (live-only fallback):', err)
  }

  const seen = new Set(liveRows.map(r => r.id))
  const merged = [
    ...liveRows,
    ...archiveRows.filter(r => !seen.has(r.id)),
  ].sort((a, b) => b.at.localeCompare(a.at))

  const total = merged.length
  const page = merged.slice(Math.max(offset, 0), Math.max(offset, 0) + Math.min(Math.max(limit, 1), 500))

  if (format === 'csv') {
    const header = ['id', 'at', 'source', 'actor', 'role', 'savedKeys', 'skippedKeys', 'deniedKeys']
    const lines = [
      header.join(','),
      ...merged.map(row =>
        [
          row.id,
          row.at,
          row.source,
          row.actor?.username ?? row.actor?.name ?? '',
          row.actor?.role ?? '',
          (row.savedKeys ?? []).join('|'),
          (row.skippedKeys ?? []).join('|'),
          (row.deniedKeys ?? []).join('|'),
        ]
          .map(cell => `"${String(cell).replace(/"/g, '""')}"`)
          .join(','),
      ),
    ]
    return new NextResponse(lines.join('\n'), {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="deed-audit-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    })
  }

  return NextResponse.json({
    ok: true,
    total,
    archiveTotal,
    liveTotal: live.length,
    offset,
    limit,
    rows: page,
  })
}
