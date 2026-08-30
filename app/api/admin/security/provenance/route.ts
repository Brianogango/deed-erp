import { NextResponse } from 'next/server'

import { getServerSession } from '@/lib/auth/server'
import { readDeploymentProvenance } from '@/lib/deployment-provenance'
import { isPrivilegedMfaEnforced } from '@/lib/auth/mfa-policy'

export async function GET() {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'director') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const provenance = readDeploymentProvenance()

  return NextResponse.json(
    {
      ok: Boolean(provenance.commitSha),
      commitSha: provenance.commitSha,
      gitRef: provenance.gitRef,
      nodeEnv: process.env.NODE_ENV || null,
      privilegedMfaEnforced: isPrivilegedMfaEnforced(),
    },
    { headers: { 'Cache-Control': 'no-store, private' } },
  )
}
