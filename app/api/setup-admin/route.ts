import { NextResponse } from 'next/server'
import { ensureUserStore } from '@/lib/auth/users-repository'

export async function GET() {
  try {
    await ensureUserStore()
    return NextResponse.json({ ok: true, message: 'Admin user ensured. Login with username: brian' })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
