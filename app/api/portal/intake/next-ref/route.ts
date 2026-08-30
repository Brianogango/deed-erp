import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * GET /api/portal/intake/next-ref
 * Ticket numbers are allocated only when the repair is created.
 * A public preview endpoint would leak valid-looking refs.
 */
export async function GET() {
  return NextResponse.json(
    { error: 'Repair references are assigned when the job is booked.' },
    { status: 404 },
  )
}
