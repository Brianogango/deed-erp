#!/usr/bin/env node
/**
 * Blob ↔ Prisma parity check (AGENT-DB-002 / DB-001 follow-up).
 *
 * Usage (from app root, with DATABASE_URL / .env loaded):
 *   npx tsx scripts/check-blob-parity.mjs
 *   npx tsx scripts/check-blob-parity.mjs --json
 *   pnpm parity:check
 *
 * Exit codes:
 *   0 — no hard-stops or dual-write gaps
 *   1 — unhealthy (catalog hard-stop or dual-write mismatch)
 *   2 — setup / runtime error
 *
 * Does not mutate data. Prefer /api/admin/blob-cutover for director certify flows.
 */

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!m) continue
    if (process.env[m[1]] != null) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    process.env[m[1]] = v
  }
}

function main() {
  const root = path.resolve(__dirname, '..')
  loadEnvFile(path.join(root, '.env.local'))
  loadEnvFile(path.join(root, '.env'))

  if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL) {
    console.error('DATABASE_URL (or POSTGRES_URL) is required')
    process.exit(2)
  }

  // Re-exec under tsx so TypeScript server-only modules resolve.
  if (!process.env.__PARITY_TSX__) {
    const r = spawnSync(
      process.platform === 'win32' ? 'npx.cmd' : 'npx',
      ['tsx', __filename, ...process.argv.slice(2)],
      {
        stdio: 'inherit',
        env: { ...process.env, __PARITY_TSX__: '1' },
        cwd: root,
      },
    )
    process.exit(r.status == null ? 2 : r.status)
  }

  runTs().catch(err => {
    console.error(err)
    process.exit(2)
  })
}

async function runTs() {
  const { verifyBlobParity } = await import('../lib/blob-cutover.server.ts')
  const { summariseParityChecks } = await import('../lib/blob-cutover.ts')

  const checks = await verifyBlobParity()
  const summary = summariseParityChecks(checks)
  const asJson = process.argv.includes('--json')

  if (asJson) {
    console.log(JSON.stringify({ summary, checks }, null, 2))
  } else {
    console.log('Blob ↔ Prisma parity report')
    console.log(`ok=${summary.ok}/${summary.total} failed=${summary.failed} hardStops=${summary.hardStops} dualWriteGaps=${summary.dualWriteGaps} blobSotLag=${summary.blobSotLag}`)
    for (const c of checks) {
      const flag = c.parityOk ? 'OK ' : 'GAP'
      const cov = c.mirrorCoverage != null ? ` coverage=${c.mirrorCoverage}` : ''
      const role = c.domainRole || '?'
      console.log(`  [${flag}] ${c.blobKey} → ${c.prismaTable}  blob=${c.blobCount} prisma=${c.prismaCount} role=${role}${cov}`)
      if (!c.parityOk && c.blockedReason) console.log(`         ${c.blockedReason}`)
    }
  }

  process.exit(summary.unhealthy ? 1 : 0)
}

main()
