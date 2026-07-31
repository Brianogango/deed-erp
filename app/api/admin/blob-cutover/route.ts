import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { isRoleAllowed } from '@/lib/auth/authorization'
import {
  archiveKeyFor,
  canArchive,
  canCertify,
  canRetireLiveKey,
  uncertifiedProtectedKeys,
} from '@/lib/blob-cutover'
import {
  copyAppStateToArchive,
  listCutoverCertificates,
  retireLiveBlobKey,
  upsertCutoverCertificate,
  verifyBlobParity,
} from '@/lib/blob-cutover.server'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

function forbidden() {
  return NextResponse.json({ error: 'Forbidden — director only' }, { status: 403 })
}

async function requireDirector() {
  const session = await getServerSession()
  if (!session) return { error: unauthorized() as NextResponse }
  if (!isRoleAllowed(session.user.role, ['director'])) return { error: forbidden() as NextResponse }
  return { session }
}

/** GET — parity report + existing certificates. Never mutates. */
export async function GET() {
  const gate = await requireDirector()
  if (gate.error) return gate.error

  const checks = await verifyBlobParity()
  const certificates = await listCutoverCertificates()
  const uncertified = uncertifiedProtectedKeys(
    certificates.map(c => ({
      blobKey: c.blobKey,
      status: c.status as 'pending' | 'verified' | 'certified' | 'archived' | 'blocked',
      parityOk: c.parityOk,
    })),
  )

  return NextResponse.json({
    functionalCurrency: 'KES',
    note: 'Never deletes app_state keys. Archive copies first; retire requires certified+archived.',
    checks,
    certificates,
    uncertifiedProtectedKeys: uncertified,
    allProtectedCertified: uncertified.length === 0,
  })
}

/**
 * POST actions:
 *  - verify: re-run parity (optionally persist verified/blocked rows)
 *  - certify: { blobKey } when parityOk
 *  - archive: { blobKey } copy live → archive:* key (keeps live)
 *  - retire: { blobKey, confirmation } delete live only if archived copy exists
 */
export async function POST(req: NextRequest) {
  const gate = await requireDirector()
  if (gate.error) return gate.error
  const session = gate.session!

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const action = String(body.action || 'verify')
  const blobKey = body.blobKey != null ? String(body.blobKey) : ''

  if (action === 'verify') {
    const keys = Array.isArray(body.keys) ? body.keys.map(String) : undefined
    const checks = await verifyBlobParity(keys)
    const persisted = []
    for (const check of checks) {
      const row = await upsertCutoverCertificate({
        blobKey: check.blobKey,
        status: check.parityOk ? 'verified' : 'blocked',
        blobCount: check.blobCount,
        prismaCount: check.prismaCount,
        parityOk: check.parityOk,
        details: {
          blockedReason: check.blockedReason,
          prismaTable: check.prismaTable,
          ...(check.details || {}),
        },
        notes: check.blockedReason || null,
      })
      persisted.push(row)
    }
    return NextResponse.json({ ok: true, action: 'verify', checks, certificates: persisted })
  }

  if (!blobKey) {
    return NextResponse.json({ error: 'blobKey is required' }, { status: 400 })
  }

  const [check] = await verifyBlobParity([blobKey])
  if (!check) {
    return NextResponse.json({ error: 'Unknown blob key' }, { status: 400 })
  }

  if (action === 'certify') {
    if (!canCertify(check)) {
      await upsertCutoverCertificate({
        blobKey,
        status: 'blocked',
        blobCount: check.blobCount,
        prismaCount: check.prismaCount,
        parityOk: false,
        details: { blockedReason: check.blockedReason, prismaTable: check.prismaTable },
        notes: check.blockedReason || 'Parity failed',
      })
      return NextResponse.json({
        ok: false,
        error: check.blockedReason || 'Parity check failed — cannot certify',
        check,
      }, { status: 409 })
    }

    const row = await upsertCutoverCertificate({
      blobKey,
      status: 'certified',
      blobCount: check.blobCount,
      prismaCount: check.prismaCount,
      parityOk: true,
      details: { prismaTable: check.prismaTable },
      certifiedBy: session.user.username || session.user.id,
      certifiedAt: new Date(),
      notes: body.notes != null ? String(body.notes) : 'Director certified soak parity',
    })
    return NextResponse.json({ ok: true, action: 'certify', certificate: row, check })
  }

  if (action === 'archive') {
    const certs = await listCutoverCertificates()
    const cert = certs.find(c => c.blobKey === blobKey)
    if (!cert || !canArchive({ status: cert.status as 'certified', parityOk: cert.parityOk })) {
      return NextResponse.json({
        ok: false,
        error: 'Certify with parityOk first before archive',
        check,
      }, { status: 409 })
    }

    // Re-verify immediately before copy
    if (!check.parityOk) {
      return NextResponse.json({ ok: false, error: check.blockedReason || 'Parity lost', check }, { status: 409 })
    }

    const archiveKey = archiveKeyFor(blobKey)
    const copy = await copyAppStateToArchive(blobKey, archiveKey)
    if (!copy.ok) {
      return NextResponse.json({ ok: false, error: copy.error }, { status: 500 })
    }

    const row = await upsertCutoverCertificate({
      blobKey,
      status: 'archived',
      blobCount: check.blobCount,
      prismaCount: check.prismaCount,
      parityOk: true,
      details: { prismaTable: check.prismaTable, liveKeyRetained: true },
      certifiedBy: cert.certifiedBy,
      certifiedAt: cert.certifiedAt,
      archivedAt: new Date(),
      archiveKey,
      notes: 'Archive copy written; live key retained until explicit retire',
    })

    return NextResponse.json({
      ok: true,
      action: 'archive',
      certificate: row,
      note: 'Live app_state key was NOT deleted. Call action=retire to remove it after soak.',
    })
  }

  if (action === 'retire') {
    const confirmation = String(body.confirmation || '').trim()
    const expected = `RETIRE ${blobKey}`
    if (confirmation !== expected) {
      return NextResponse.json({
        error: `Type "${expected}" to retire the live blob key after archive`,
      }, { status: 400 })
    }

    const certs = await listCutoverCertificates()
    const cert = certs.find(c => c.blobKey === blobKey)
    if (!cert || !canRetireLiveKey({
      status: cert.status as 'archived',
      parityOk: cert.parityOk,
      archiveKey: cert.archiveKey,
    })) {
      return NextResponse.json({
        ok: false,
        error: 'Archive+certify required before retiring the live key',
      }, { status: 409 })
    }

    const retired = await retireLiveBlobKey(blobKey, cert.archiveKey!)
    if (!retired.ok) {
      return NextResponse.json({ ok: false, error: retired.error }, { status: 500 })
    }

    const row = await upsertCutoverCertificate({
      blobKey,
      status: 'archived',
      blobCount: cert.blobCount,
      prismaCount: cert.prismaCount,
      parityOk: true,
      details: { prismaTable: (cert.details as any)?.prismaTable, liveKeyRetired: true },
      certifiedBy: cert.certifiedBy,
      certifiedAt: cert.certifiedAt,
      archivedAt: cert.archivedAt ?? new Date(),
      archiveKey: cert.archiveKey,
      notes: `Live key retired by ${session.user.username || session.user.id}; restore from ${cert.archiveKey}`,
    })

    return NextResponse.json({
      ok: true,
      action: 'retire',
      certificate: row,
      note: `Live key ${blobKey} removed. Restore from archive key ${cert.archiveKey} if needed.`,
    })
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
}
