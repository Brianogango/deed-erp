// Move legacy inline base64 diagnosis/QC reports out of the deed_repairs_v2
// blob onto disk, replacing them with lightweight download URLs. One inline
// PDF (~183 KB base64) accounted for ~40% of the repairs payload shipped to
// every client on every load. Idempotent; run from the app root so the files
// land where the serving routes expect them:
//
//   node scripts/externalize-repair-reports.mjs            # apply
//   node scripts/externalize-repair-reports.mjs --dry-run  # report only
import 'dotenv/config'
import { Pool } from 'pg'
import { promises as fs } from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'

const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL
if (!connectionString) {
  console.error('No database URL found. Set DATABASE_URL.')
  process.exit(1)
}
const DRY = process.argv.includes('--dry-run')

const EXT_BY_TYPE = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
}

const refDirName = ref => String(ref).toUpperCase().replace(/\//g, '_').replace(/[^a-zA-Z0-9._-]+/g, '_')

// Matches the serving routes' storage roots and app_state meta keys:
//   diagnosis: .uploads/diagnosis-reports + repair_diagnosis_reports_<REF>
//   qc:        .uploads/qc-reports        + repair_qc_reports_<REF>
const KINDS = {
  diagnosis: {
    dataField: 'diagnosisReportData', nameField: 'diagnosisReportName', urlField: 'diagnosisReportUrl',
    storageDir: 'diagnosis-reports', stateKey: ref => `repair_diagnosis_reports_${refDirName(ref)}`,
    url: (ref, id) => `/api/portal/repair/${encodeURIComponent(ref)}/diagnosis-report/${encodeURIComponent(id)}`,
  },
  qc: {
    dataField: 'qcReportData', nameField: 'qcReportName', urlField: 'qcReportUrl',
    storageDir: 'qc-reports', stateKey: ref => `repair_qc_reports_${refDirName(ref)}`,
    url: (ref, id) => `/api/portal/repair/${encodeURIComponent(ref)}/qc-report/${encodeURIComponent(id)}`,
  },
}

const pool = new Pool({ connectionString, ssl: false })
const client = await pool.connect()
try {
  const { rows } = await client.query(`SELECT value FROM app_state WHERE key = 'deed_repairs_v2'`)
  if (!rows.length) { console.log('No deed_repairs_v2 key found.'); process.exit(0) }
  const repairs = JSON.parse(rows[0].value)
  const before = rows[0].value.length

  let moved = 0
  for (const repair of repairs) {
    for (const kind of Object.values(KINDS)) {
      const dataUrl = repair[kind.dataField]
      if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) continue
      const match = dataUrl.match(/^data:([^;,]+);base64,([\s\S]*)$/)
      if (!match) continue
      const contentType = match[1] || 'application/octet-stream'
      const buffer = Buffer.from(match[2], 'base64')
      const id = randomUUID()
      const name = repair[kind.nameField] || `report${EXT_BY_TYPE[contentType] ?? ''}`
      console.log(`${DRY ? '[DRY RUN] ' : ''}${repair.ref}: ${kind.dataField} ${(buffer.length / 1024).toFixed(0)} KB → ${kind.storageDir}`)
      moved++
      if (DRY) continue

      const dir = path.join(process.cwd(), '.uploads', kind.storageDir, refDirName(repair.ref))
      await fs.mkdir(dir, { recursive: true })
      const storagePath = path.join(dir, `${id}${EXT_BY_TYPE[contentType] ?? ''}`)
      await fs.writeFile(storagePath, buffer)

      const metaKey = kind.stateKey(repair.ref)
      const metaRes = await client.query('SELECT value FROM app_state WHERE key = $1', [metaKey])
      const existing = metaRes.rows.length ? JSON.parse(metaRes.rows[0].value) : []
      const meta = {
        id, name, size: buffer.length, contentType,
        uploadedAt: new Date().toISOString(),
        url: kind.url(repair.ref, id), storagePath,
      }
      await client.query(
        `INSERT INTO app_state (key, value, updated_at) VALUES ($1, $2, $3)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
        [metaKey, JSON.stringify([...existing, meta]), new Date().toISOString()],
      )

      repair[kind.urlField] = meta.url
      delete repair[kind.dataField]
    }
  }

  if (!DRY && moved > 0) {
    const next = JSON.stringify(repairs)
    await client.query(
      `UPDATE app_state SET value = $1, updated_at = $2 WHERE key = 'deed_repairs_v2'`,
      [next, new Date().toISOString()],
    )
    console.log(`deed_repairs_v2: ${(before / 1024).toFixed(0)} KB → ${(next.length / 1024).toFixed(0)} KB`)
  }
  console.log(`${DRY ? '[DRY RUN] ' : ''}Externalized ${moved} report(s).`)
} catch (error) {
  console.error('Report externalization failed:', error)
  process.exitCode = 1
} finally {
  client.release()
  await pool.end()
}
