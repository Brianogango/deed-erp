import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { sql } from '@/lib/auth/db'

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['director', 'admin_officer'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    // Clear app_state (all ERP localStorage-synced data)
    await sql`DELETE FROM app_state`

    // Clear all structured Prisma tables in dependency order (children first)
    await sql`DELETE FROM invoice_lines`
    await sql`DELETE FROM invoices`
    await sql`DELETE FROM sale_order_lines`
    await sql`DELETE FROM sale_orders`
    await sql`DELETE FROM po_lines`
    await sql`DELETE FROM purchase_orders`
    await sql`DELETE FROM repair_orders`
    await sql`DELETE FROM serials`
    await sql`DELETE FROM warranties`
    await sql`DELETE FROM kilimall_orders`
    await sql`DELETE FROM employees`
    await sql`DELETE FROM contacts`
    await sql`DELETE FROM products`
    await sql`DELETE FROM app_settings`

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[reset] error:', err)
    return NextResponse.json({ error: 'Reset failed', detail: String(err) }, { status: 500 })
  }
}
