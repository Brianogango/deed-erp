import { NextResponse } from 'next/server'
import { getNextRepairRef } from '@/lib/repair-ref-counter'

export const dynamic = 'force-dynamic'

/**
 * GET /api/portal/intake/next-ref
 * Returns the next unique repair reference number for portal intake.
 * Public endpoint (no authentication required for portal customers).
 */
export async function GET() {
  try {
    const ref = await getNextRepairRef()
    return NextResponse.json({ ref }, { status: 200 })
  } catch (err) {
    console.error('[portal-intake-next-ref] Error generating repair reference:', err)
    return NextResponse.json(
      { error: 'Failed to generate repair reference' },
      { status: 500 }
    )
  }
}
