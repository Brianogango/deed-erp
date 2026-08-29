#!/usr/bin/env node
/**
 * Align blob deed_contacts paymentTermsDays with the 0-day default.
 * Prisma clients are updated by 20260829_contact_payment_terms_default_zero_safe.sql.
 *
 *   node scripts/zero-contact-payment-terms.mjs          # dry-run
 *   node scripts/zero-contact-payment-terms.mjs --apply
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
function loadEnvFile(fp) {
  if (!existsSync(fp)) return
  for (const line of readFileSync(fp, 'utf8').split('\n')) {
    const t = line.trim(); if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('='); if (eq <= 0) continue
    const k = t.slice(0, eq).trim(); let v = t.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (!(k in process.env)) process.env[k] = v
  }
}
loadEnvFile(resolve(ROOT, '.env')); loadEnvFile(resolve(ROOT, '.env.local'))

const APPLY = process.argv.includes('--apply')
const cs = process.env.deed_erp_POSTGRES_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL
if (!cs) { console.error('ERROR: DATABASE_URL / POSTGRES_URL is not set'); process.exit(1) }

const pool = new Pool({ connectionString: cs })
const client = await pool.connect()
try {
  const { rows } = await client.query('SELECT value FROM app_state WHERE key = $1', ['deed_contacts'])
  if (!rows.length) {
    console.log('No deed_contacts blob')
  } else {
    const contacts = JSON.parse(rows[0].value)
    const toFix = contacts.filter((c) => c.paymentTermsDays == null || Number(c.paymentTermsDays) === 30)
    console.log(`Blob contacts: ${contacts.length}; to set to 0 days: ${toFix.length}`)
    if (APPLY && toFix.length) {
      const next = contacts.map((c) => (
        c.paymentTermsDays == null || Number(c.paymentTermsDays) === 30
          ? { ...c, paymentTermsDays: 0 }
          : c
      ))
      await client.query(
        'INSERT INTO app_state (key, value, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()',
        ['deed_contacts', JSON.stringify(next)],
      )
      console.log(`Updated ${toFix.length} blob contacts to paymentTermsDays=0`)
    } else if (!APPLY) {
      console.log('Dry-run. Re-run with --apply to write.')
    }
  }
} catch (e) {
  console.error('ERROR:', e.message)
  process.exitCode = 1
} finally {
  client.release(); await pool.end()
}
