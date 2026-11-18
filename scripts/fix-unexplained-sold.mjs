#!/usr/bin/env node
/**
 * Put back the units marked sold that were never sold.
 *
 *   node scripts/fix-unexplained-sold.mjs                        dry run (default)
 *   node scripts/fix-unexplained-sold.mjs --to shop --apply      write it
 *   node scripts/fix-unexplained-sold.mjs --only 5CG7103VK4,5CG6283B4V --to shop --apply
 *
 * It only touches units that satisfy ALL of:
 *   - marked sold, or sitting at location `customer`;
 *   - no invoice, sale order, till sale or invoice line names them;
 *   - no stock movement has ever been recorded against them.
 *
 * The last condition is the important one. A unit that physically moved
 * probably WAS sold and only lost its paperwork — putting it back on the
 * shelf would invent stock that is not there. Those are listed and left
 * alone; match them to their invoice first (inventory-health.mjs --match).
 *
 * Every change writes a stock movement and an audit row, so the correction
 * is as visible afterwards as the thing it corrected.
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return
  for (const line of readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = value
  }
}
loadEnvFile(resolve(ROOT, '.env'))
loadEnvFile(resolve(ROOT, '.env.local'))

const args = process.argv.slice(2)
const flag = name => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : ''
}
const apply = args.includes('--apply')
const target = flag('--to')
const only = flag('--only').split(',').map(s => s.trim()).filter(Boolean)
const reason = flag('--reason') || 'Marked sold with no sale on record and no movement; returned to stock after review'

const LOCATIONS = ['shop', 'warehouse', 'computer_aid', 'repair_unit', 'pending_testing']

function fail(message) { console.error(`ERROR: ${message}`); process.exit(1) }

if (apply && !target) fail(`--apply needs --to <location>, one of: ${LOCATIONS.join(', ')}`)
if (target && !LOCATIONS.includes(target)) fail(`--to must be one of: ${LOCATIONS.join(', ')}`)

const connectionString =
  process.env.deed_erp_POSTGRES_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL
if (!connectionString) fail('DATABASE_URL / POSTGRES_URL is not set')

const pool = new Pool({ connectionString, ssl: false })
const q = (text, values = []) => pool.query(text, values).then(r => r.rows)
const pad = (v, w) => String(v ?? '').padEnd(w).slice(0, w)

const SOLD_EVIDENCE = `(
  s.sold_via_invoice_id IS NOT NULL
  OR EXISTS (SELECT 1 FROM sale_order_items soi WHERE s.id::text = ANY(soi.serial_ids))
  OR EXISTS (SELECT 1 FROM pos_transaction_items p WHERE p.serial_number_id = s.id)
  OR EXISTS (SELECT 1 FROM invoice_items ii WHERE ii.serial_number_id = s.id)
)`

async function main() {
  const candidates = await q(`
    SELECT s.id, s.serial_number, s.status, s.location, s.product_id,
           pr.name AS product,
           s.screen_extras->>'soldDate' AS sold_date,
           EXISTS (SELECT 1 FROM stock_movements m WHERE m.serial_number_id = s.id) AS has_movements
      FROM serial_numbers s
      LEFT JOIN products pr ON pr.id = s.product_id
     WHERE s.removed_at IS NULL
       AND (s.status = 'sold' OR s.location = 'customer')
       AND NOT ${SOLD_EVIDENCE}
     ORDER BY pr.name, s.serial_number`)

  const wanted = only.length
    ? candidates.filter(c => only.some(o => o.toUpperCase().replace(/[^A-Z0-9]/g, '') === String(c.serial_number).toUpperCase().replace(/[^A-Z0-9]/g, '')))
    : candidates
  const safe = wanted.filter(c => !c.has_movements)
  const moved = wanted.filter(c => c.has_movements)

  console.log('')
  console.log(`${candidates.length} unit${candidates.length === 1 ? '' : 's'} marked sold with no sale on record${only.length ? `, ${wanted.length} matching --only` : ''}`)
  console.log(`  ${safe.length} never moved — these are the ones this script returns to stock`)
  console.log(`  ${moved.length} did move — left alone, they need their invoice found first`)
  console.log('')

  if (moved.length) {
    console.log('LEFT ALONE (a movement says the machine really went somewhere)')
    for (const m of moved) console.log(`  ${pad(m.serial_number, 24)} ${pad(m.product, 44)} sold ${m.sold_date ?? '—'}`)
    console.log('')
  }

  if (!safe.length) {
    console.log('Nothing to return to stock.')
    console.log('')
    return
  }

  console.log(apply ? `RETURNING TO STOCK AT "${target}"` : 'WOULD RETURN TO STOCK (dry run — add --to <location> --apply to write)')
  for (const s of safe) {
    console.log(`  ${pad(s.serial_number, 24)} ${pad(s.product, 44)} ${pad(`${s.status} @ ${s.location}`, 22)} sold ${s.sold_date ?? '—'}`)
  }
  console.log('')

  if (!apply) {
    console.log(`Dry run: nothing was changed. Re-run with --to <location> --apply to write ${safe.length} change${safe.length === 1 ? '' : 's'}.`)
    console.log('')
    return
  }

  const actor = (await q(`SELECT id FROM users WHERE role = 'director' AND is_active ORDER BY created_at LIMIT 1`))[0]?.id ?? null
  let done = 0
  for (const s of safe) {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(`
        UPDATE serial_numbers
           SET status = 'in_stock',
               location = $2,
               screen_extras = (coalesce(screen_extras, '{}'::jsonb) - 'soldDate' - 'saleOrderId')
                               || jsonb_build_object('statusCorrectedAt', now()::date::text, 'statusCorrectedReason', $3::text),
               updated_at = now()
         WHERE id = $1`, [s.id, target, reason])
      // The correction leaves its own trail, the same way a real move does.
      await client.query(`
        INSERT INTO stock_movements
          (id, product_id, serial_number_id, movement_type, qty, qty_before, qty_after,
           from_location, to_location, reference_type, notes, created_by, created_at)
        VALUES (gen_random_uuid(), $1, $2, 'adjustment_in', 1, 0, 1, $3, $4, 'correction', $5, $6, now())`,
        [s.product_id, s.id, s.location, target, `${reason} (was ${s.status})`, actor])
      await client.query(`
        INSERT INTO audit_logs (user_id, action, entity_type, entity_key, new_values, created_at)
        VALUES ($1, 'correct_serial_status', 'serial', $2, $3::jsonb, now())`,
        [actor, s.serial_number, JSON.stringify({
          details: `${s.serial_number} returned to stock at ${target} — ${reason}`,
          username: 'inventory-cleanup',
          from: { status: s.status, location: s.location, soldDate: s.sold_date },
        })])
      await client.query('COMMIT')
      done += 1
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      console.error(`  ! ${s.serial_number}: ${err.message}`)
    } finally {
      client.release()
    }
  }

  console.log('')
  console.log(`${done} of ${safe.length} returned to stock at "${target}".`)
  console.log('Each one has a stock movement and an audit entry behind it.')
  console.log('')
}

main()
  .catch(err => { console.error(`ERROR: ${err.message}`); process.exitCode = 1 })
  .finally(() => pool.end())
