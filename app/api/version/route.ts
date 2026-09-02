import { NextResponse } from 'next/server'
import { getServerBuildId } from '@/lib/app-version'

export const dynamic = 'force-dynamic'

/**
 * The build the server is currently running. The client compares this against
 * the build its page was loaded from (meta[name="deed-build"]) to detect a
 * stale tab after a deploy. Unauthenticated by design — a build id is not
 * sensitive, and the check must work for any stale page state.
 */
export async function GET() {
  return NextResponse.json(
    { buildId: getServerBuildId() },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
