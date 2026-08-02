#!/usr/bin/env node
/**
 * Ops helper: remove ERP test/demo records whose identity fields contain the
 * whole words "explore" and/or "test" (case-insensitive).
 *
 * Covers Prisma master tables + deed_* JSON arrays in app_state.
 *
 *   node scripts/purge-explore-test-data.mjs            # dry-run (default)
 *   node scripts/purge-explore-test-data.mjs --apply    # delete for real
 */
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

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

const apply = process.argv.includes('--apply')
const MATCH = /\b(explore|test)\b/i

/** Human-facing identity fields on JSON blob records */
const IDENTITY_FIELDS = [
  'name', 'title', 'subject', 'label', 'sku',
  'companyName', 'company_name',
  'customerName', 'customer_name', 'clientName', 'client_name',
  'partnerName', 'partner_name',
  'productName', 'product_name',
  'supplierName', 'supplier_name',
  'firstName', 'first_name', 'lastName', 'last_name',
  'contactName', 'contact_name', 'contactPerson', 'contact_person',
  'employeeName', 'employee_name',
  'reference', 'ref', 'number', 'clientNumber', 'client_number',
]

function fail(msg) {
  console.error(`ERROR: ${msg}`)
  process.exit(1)
}

function isMatch(...parts) {
  return parts.some(p => typeof p === 'string' && MATCH.test(p))
}

function recordMatches(obj) {
  if (!obj || typeof obj !== 'object') return false
  for (const key of IDENTITY_FIELDS) {
    if (isMatch(obj[key])) return true
  }
  if (isMatch([obj.firstName, obj.first_name, obj.lastName, obj.last_name].filter(Boolean).join(' '))) {
    return true
  }
  return false
}

const connectionString =
  process.env.deed_erp_POSTGRES_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL
if (!connectionString) fail('DATABASE_URL / POSTGRES_URL is not set')

const pool = new Pool({ connectionString })

async function tableExists(client, name) {
  const { rows } = await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
    [name],
  )
  return rows.length > 0
}

async function saveJson(client, key, value) {
  const payload = JSON.stringify(value)
  const updatedAt = new Date().toISOString()
  await client.query(
    `INSERT INTO app_state (key, value, updated_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
    [key, payload, updatedAt],
  )
}

async function execCount(client, label, sql, params = []) {
  try {
    const res = await client.query(sql, params)
    const n = res.rowCount ?? 0
    if (n) console.log(`  ${label}: ${n}`)
    return n
  } catch (err) {
    console.warn(`  warn ${label}: ${err.message}`)
    return 0
  }
}

async function findSqlMatches(client, table, idCol, labelCols) {
  if (!(await tableExists(client, table))) return []
  const cols = [idCol, ...labelCols]
  const select = cols.join(', ')
  const predicates = labelCols
    .map(c => `(${c} IS NOT NULL AND (${c} ~* '\\yexplore\\y' OR ${c} ~* '\\ytest\\y'))`)
    .join(' OR ')
  const sql = `SELECT ${select} FROM ${table} WHERE (${predicates})`
  try {
    const { rows } = await client.query(sql)
    return rows.map(r => ({
      table,
      id: r[idCol],
      label: labelCols.map(c => r[c]).filter(Boolean).join(' · '),
    }))
  } catch (err) {
    console.warn(`  skip ${table}: ${err.message}`)
    return []
  }
}

async function deleteByIds(client, table, idCol, ids) {
  if (!ids.length) return 0
  const { rowCount } = await client.query(
    `DELETE FROM ${table} WHERE ${idCol} = ANY($1::uuid[])`,
    [ids],
  )
  return rowCount ?? 0
}

/** Remove docs tied to test clients so required FKs don't block the delete. */
async function purgeClientDependents(client, clientIds) {
  if (!clientIds.length) return
  const p = [clientIds]

  // Child lines first where needed
  await execCount(client, 'opportunity_activities',
    `DELETE FROM opportunity_activities WHERE opportunity_id IN (SELECT id FROM opportunities WHERE client_id = ANY($1::uuid[]))`, p)
  await execCount(client, 'opportunities', `DELETE FROM opportunities WHERE client_id = ANY($1::uuid[])`, p)
  await execCount(client, 'contact_persons', `DELETE FROM contact_persons WHERE client_id = ANY($1::uuid[])`, p)
  await execCount(client, 'leads', `DELETE FROM leads WHERE client_id = ANY($1::uuid[])`, p)
  await execCount(client, 'customer_assets', `DELETE FROM customer_assets WHERE client_id = ANY($1::uuid[])`, p)

  if (await tableExists(client, 'quote_items')) {
    await execCount(client, 'quote_items',
      `DELETE FROM quote_items WHERE quote_id IN (SELECT id FROM quotes WHERE client_id = ANY($1::uuid[]))`, p)
  }
  await execCount(client, 'quotes', `DELETE FROM quotes WHERE client_id = ANY($1::uuid[])`, p)

  if (await tableExists(client, 'invoice_items')) {
    await execCount(client, 'invoice_items',
      `DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE client_id = ANY($1::uuid[]))`, p)
  }
  // payment allocations → payments → invoices
  if (await tableExists(client, 'payment_allocations')) {
    await execCount(client, 'payment_allocations',
      `DELETE FROM payment_allocations WHERE invoice_id IN (SELECT id FROM invoices WHERE client_id = ANY($1::uuid[]))`, p)
  }
  await execCount(client, 'invoices', `DELETE FROM invoices WHERE client_id = ANY($1::uuid[])`, p)

  if (await tableExists(client, 'sale_order_items')) {
    await execCount(client, 'sale_order_items',
      `DELETE FROM sale_order_items WHERE sale_order_id IN (SELECT id FROM sale_orders WHERE client_id = ANY($1::uuid[]))`, p)
  }
  if (await tableExists(client, 'delivery_note_items')) {
    await execCount(client, 'delivery_note_items',
      `DELETE FROM delivery_note_items WHERE delivery_note_id IN (SELECT id FROM delivery_notes WHERE client_id = ANY($1::uuid[]))`, p)
  }
  await execCount(client, 'delivery_notes', `DELETE FROM delivery_notes WHERE client_id = ANY($1::uuid[])`, p)
  await execCount(client, 'sale_orders', `DELETE FROM sale_orders WHERE client_id = ANY($1::uuid[])`, p)

  if (await tableExists(client, 'repair_parts')) {
    await execCount(client, 'repair_parts',
      `DELETE FROM repair_parts WHERE repair_id IN (SELECT id FROM repairs WHERE client_id = ANY($1::uuid[]))`, p)
  }
  if (await tableExists(client, 'repair_stages')) {
    await execCount(client, 'repair_stages',
      `DELETE FROM repair_stages WHERE repair_id IN (SELECT id FROM repairs WHERE client_id = ANY($1::uuid[]))`, p)
  }
  await execCount(client, 'repairs', `DELETE FROM repairs WHERE client_id = ANY($1::uuid[])`, p)

  await execCount(client, 'credit_notes', `DELETE FROM credit_notes WHERE client_id = ANY($1::uuid[])`, p)
  await execCount(client, 'pos_transactions', `DELETE FROM pos_transactions WHERE client_id = ANY($1::uuid[])`, p)

  if (await tableExists(client, 'kilimall_order_items')) {
    await execCount(client, 'kilimall_order_items',
      `DELETE FROM kilimall_order_items WHERE kilimall_order_id IN (SELECT id FROM kilimall_orders WHERE client_id = ANY($1::uuid[]))`, p)
  }
  await execCount(client, 'kilimall_orders', `DELETE FROM kilimall_orders WHERE client_id = ANY($1::uuid[])`, p)

  if (await tableExists(client, 'outbound_release_log')) {
    await execCount(client, 'outbound_release_log',
      `DELETE FROM outbound_release_log WHERE release_id IN (SELECT id FROM outbound_releases WHERE client_id = ANY($1::uuid[]))`, p)
  }
  if (await tableExists(client, 'outbound_release_items')) {
    await execCount(client, 'outbound_release_items',
      `DELETE FROM outbound_release_items WHERE release_id IN (SELECT id FROM outbound_releases WHERE client_id = ANY($1::uuid[]))`, p)
  }
  await execCount(client, 'outbound_releases', `DELETE FROM outbound_releases WHERE client_id = ANY($1::uuid[])`, p)
}

async function purgeProductDependents(client, productIds) {
  if (!productIds.length) return
  const p = [productIds]
  const deletes = [
    'pos_transaction_items',
    'sale_order_items',
    'invoice_items',
    'quote_items',
    'delivery_note_items',
    'purchase_order_items',
    'grn_items',
    'repair_parts',
    'stock_adjustment_items',
    'kilimall_order_items',
    'product_images',
    'serial_numbers',
    'stock_levels',
    'inventory_batches',
    'stock_movements',
    'label_print_jobs',
  ]
  for (const table of deletes) {
    if (!(await tableExists(client, table))) continue
    await execCount(client, table, `DELETE FROM ${table} WHERE product_id = ANY($1::uuid[])`, p)
  }
}

async function scrubAppStateArrays(client) {
  const { rows } = await client.query(
    `SELECT key, value FROM app_state WHERE key LIKE 'deed_%' ORDER BY key`,
  )
  const report = []
  for (const row of rows) {
    let parsed
    try {
      parsed = JSON.parse(row.value)
    } catch {
      continue
    }
    if (!Array.isArray(parsed)) continue

    const kept = []
    const removed = []
    for (const item of parsed) {
      if (recordMatches(item)) removed.push(item)
      else kept.push(item)
    }
    if (!removed.length) continue

    report.push({
      key: row.key,
      removed: removed.length,
      samples: removed.slice(0, 8).map(r => ({
        id: r?.id,
        label: IDENTITY_FIELDS.map(f => r?.[f]).filter(Boolean).slice(0, 3).join(' · ') || '(no label)',
      })),
    })

    if (apply) await saveJson(client, row.key, kept)
  }
  return report
}

async function main() {
  console.log(apply ? 'MODE: APPLY (will delete)' : 'MODE: DRY-RUN (no deletes)')
  console.log('Match: whole words "explore" or "test" (case-insensitive)\n')

  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    const scans = [
      ['clients', 'id', ['name', 'company_name']],
      ['suppliers', 'id', ['name', 'contact_person']],
      ['products', 'id', ['name', 'sku']],
      ['leads', 'id', ['name', 'company_name']],
      ['opportunities', 'id', ['name']],
      ['contact_persons', 'id', ['first_name', 'last_name']],
      ['partner_api_keys', 'id', ['name']],
      ['categories', 'id', ['name']],
      ['brands', 'id', ['name']],
      ['deposits', 'id', ['customer_name']],
      ['holdovers', 'id', ['customer_name', 'product_name']],
      ['kilimall_orders', 'id', ['customer_name']],
    ]

    const byTable = new Map()
    for (const [table, idCol, labels] of scans) {
      const hits = await findSqlMatches(client, table, idCol, labels)
      if (hits.length) {
        byTable.set(table, hits)
        console.log(`[${table}] ${hits.length} match(es):`)
        for (const h of hits.slice(0, 20)) console.log(`  - ${h.id}  ${h.label}`)
        if (hits.length > 20) console.log(`  … +${hits.length - 20} more`)
      }
    }

    // deposit_items product_name → collect parent deposit ids
    if (await tableExists(client, 'deposit_items')) {
      try {
        const { rows } = await client.query(
          `SELECT DISTINCT deposit_id AS id, product_name AS label
           FROM deposit_items
           WHERE product_name IS NOT NULL
             AND (product_name ~* '\\yexplore\\y' OR product_name ~* '\\ytest\\y')`,
        )
        if (rows.length) {
          const existing = byTable.get('deposits') || []
          const seen = new Set(existing.map(r => r.id))
          for (const r of rows) {
            if (!seen.has(r.id)) existing.push({ table: 'deposits', id: r.id, label: `item: ${r.label}` })
          }
          byTable.set('deposits', existing)
          console.log(`[deposit_items→deposits] ${rows.length} parent deposit(s) flagged`)
        }
      } catch (err) {
        console.warn(`  skip deposit_items: ${err.message}`)
      }
    }

    console.log('\nScanning app_state deed_* arrays…')
    const blobReport = await scrubAppStateArrays(client)
    if (!blobReport.length) console.log('  (no matching array items)')
    for (const b of blobReport) {
      console.log(`[${b.key}] remove ${b.removed}:`)
      for (const s of b.samples) console.log(`  - ${s.id ?? '?'}  ${s.label}`)
    }

    if (!byTable.size && !blobReport.length) {
      console.log('\nNothing to purge.')
      await client.query('ROLLBACK')
      return
    }

    if (!apply) {
      await client.query('ROLLBACK')
      const out = {
        mode: 'dry-run',
        tables: Object.fromEntries([...byTable].map(([t, rows]) => [t, rows])),
        blobs: blobReport,
      }
      const reportPath = '/tmp/purge-explore-test-dry-run.json'
      writeFileSync(reportPath, JSON.stringify(out, null, 2))
      console.log(`\nDry-run complete. Report: ${reportPath}`)
      console.log('Re-run with --apply to delete.')
      return
    }

    const clientIds = (byTable.get('clients') || []).map(r => r.id)
    const productIds = (byTable.get('products') || []).map(r => r.id)
    const depositIds = (byTable.get('deposits') || []).map(r => r.id)

    if (clientIds.length) {
      console.log(`\nPurging dependents for ${clientIds.length} client(s)…`)
      await purgeClientDependents(client, clientIds)
    }
    if (productIds.length) {
      console.log(`\nPurging dependents for ${productIds.length} product(s)…`)
      await purgeProductDependents(client, productIds)
    }
    if (depositIds.length && (await tableExists(client, 'deposit_payments'))) {
      await execCount(client, 'deposit_payments',
        `DELETE FROM deposit_payments WHERE deposit_id = ANY($1::uuid[])`, [depositIds])
      await execCount(client, 'deposit_items',
        `DELETE FROM deposit_items WHERE deposit_id = ANY($1::uuid[])`, [depositIds])
    }

    if (byTable.get('kilimall_orders')?.length && (await tableExists(client, 'kilimall_order_items'))) {
      const ids = byTable.get('kilimall_orders').map(r => r.id)
      await execCount(client, 'kilimall_order_items',
        `DELETE FROM kilimall_order_items WHERE kilimall_order_id = ANY($1::uuid[])`, [ids])
    }

    const deleteOrder = [
      'contact_persons',
      'leads',
      'opportunities',
      'deposits',
      'holdovers',
      'partner_api_keys',
      'kilimall_orders',
      'products',
      'categories',
      'brands',
      'suppliers',
      'clients',
    ]

    const deleted = {}
    for (const table of deleteOrder) {
      const rows = byTable.get(table)
      if (!rows?.length) continue
      const n = await deleteByIds(client, table, 'id', rows.map(r => r.id))
      deleted[table] = n
      console.log(`Deleted ${n} from ${table}`)
    }

    await client.query('COMMIT')
    console.log('\nPurge applied successfully.')
    console.log(JSON.stringify({
      deleted,
      blobs: blobReport.map(b => ({ key: b.key, removed: b.removed })),
    }, null, 2))
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
