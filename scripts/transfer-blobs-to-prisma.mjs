#!/usr/bin/env node
/**
 * Copy every JSON app_state collection into Prisma store_records and upsert
 * dedicated relational tables. Binary object-store files are skipped.
 *
 * Usage (from app root, with DATABASE_URL / .env loaded):
 *   npm run migrate:store-records:safe
 *   npm run transfer:blobs
 *   npm run transfer:blobs -- --retire   # also needs RETIRE_APP_STATE
 *
 * Prefer POST /api/admin/blob-transfer from a director session.
 * Retire deletes live app_state keys only after a Prisma copy exists.
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

  if (!process.env.__TRANSFER_TSX__) {
    const r = spawnSync(
      process.platform === 'win32' ? 'npx.cmd' : 'npx',
      ['tsx', __filename, ...process.argv.slice(2)],
      {
        stdio: 'inherit',
        env: { ...process.env, __TRANSFER_TSX__: '1' },
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
  const retire = process.argv.includes('--retire')
  if (retire && process.env.RETIRE_APP_STATE !== 'RETIRE_APP_STATE') {
    console.error('Refusing to retire live app_state. Set RETIRE_APP_STATE=RETIRE_APP_STATE and pass --retire.')
    process.exit(2)
  }

  const { transferBlobsToPrisma } = await import('../lib/blob-transfer.ts')
  const result = await transferBlobsToPrisma({ retire })
  console.log(JSON.stringify(result, null, 2))
  process.exit(result.ok ? 0 : 1)
}

main()
