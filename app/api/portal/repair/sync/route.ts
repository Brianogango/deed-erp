import { NextRequest, NextResponse } from 'next/server'
import { registerPortalRepair, type PortalRepair } from '@/lib/portal-repairs'

export async function POST(req: NextRequest) {
  const { repair } = await req.json() as { repair: PortalRepair }
  if (!repair?.ref) return NextResponse.json({ error: 'Missing repair ref' }, { status: 400 })
  registerPortalRepair(repair)
  return NextResponse.json({ ok: true })
}
