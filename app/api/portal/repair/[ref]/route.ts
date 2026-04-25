import { NextRequest, NextResponse } from 'next/server'
import { lookupRepair } from '@/lib/portal-repair-server'

export async function GET(
  _req: NextRequest,
  { params }: { params: { ref: string } }
) {
  const ref = decodeURIComponent(params.ref)
  const repair = await lookupRepair(ref)

  if (!repair) {
    return NextResponse.json(
      { error: 'Repair not found. Please check your reference number and try again.' },
      { status: 404 }
    )
  }

  return NextResponse.json({ repair }, { status: 200 })
}
