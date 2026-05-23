import { NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { getNextRepairRef } from '@/lib/repair-ref-counter'

/**
 * GET /api/repairs/next-ref
 * Returns the next unique repair reference number.
 * Authenticated staff only.
 */
export async function GET() {
  const session = await getServerSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const ref = await getNextRepairRef()
    return NextResponse.json({ ref }, { status: 200 })
  } catch (err) {
    console.error('[next-ref] Error generating repair reference:', err)
    return NextResponse.json(
      { error: 'Failed to generate repair reference' },
      { status: 500 }
    )
  }
}
