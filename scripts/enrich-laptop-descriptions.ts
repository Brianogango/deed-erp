#!/usr/bin/env node
/**
 * Enrich thin laptop product descriptions (screen, touch/x360, GPU).
 *
 *   npx tsx scripts/enrich-laptop-descriptions.ts --from-csv /tmp/prod-laptops.csv
 *   npx tsx scripts/enrich-laptop-descriptions.ts --apply
 *
 * --apply updates products.description and matching deed_products blob rows.
 */
import { readFileSync } from 'node:fs'
import { Pool } from 'pg'
import { planLaptopDescriptionUpdate } from '../lib/inventory/laptop-description'

function arg(flag: string, fallback: string | null = null) {
  const i = process.argv.indexOf(flag)
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1]
  return fallback
}

function parseCsv(s: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let i = 0
  let inQ = false
  while (i < s.length) {
    const c = s[i]
    if (inQ) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i += 2; continue }
      if (c === '"') { inQ = false; i += 1; continue }
      cell += c
      i += 1
      continue
    }
    if (c === '"') { inQ = true; i += 1; continue }
    if (c === ',') { row.push(cell); cell = ''; i += 1; continue }
    if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i += 1
      row.push(cell)
      if (row.some(x => x.length)) rows.push(row)
      row = []
      cell = ''
      i += 1
      continue
    }
    cell += c
    i += 1
  }
  if (cell.length || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}

type PlanRow = {
  id: string
  sku: string
  name: string
  previous: string
  next: string | null
  action: ReturnType<typeof planLaptopDescriptionUpdate>['action']
}

function planRows(items: Array<{ id: string; sku: string; name: string; description: string }>): PlanRow[] {
  return items.map(item => {
    const plan = planLaptopDescriptionUpdate({ name: item.name, description: item.description })
    return {
      id: item.id,
      sku: item.sku,
      name: item.name,
      previous: String(item.description || '').trim(),
      next: plan.next,
      action: plan.action,
    }
  })
}

function printSummary(rows: PlanRow[]) {
  const counts = new Map<string, number>()
  for (const row of rows) counts.set(row.action, (counts.get(row.action) || 0) + 1)
  console.log(JSON.stringify({ counts: Object.fromEntries(counts), total: rows.length }))
  const updates = rows.filter(r => r.action === 'update')
  for (const row of updates.slice(0, 12)) {
    console.log(`\n${row.name}`)
    console.log(`  was: ${row.previous || '(empty)'}`)
    console.log(`  now: ${row.next}`)
  }
  if (updates.length > 12) console.log(`\n… ${updates.length - 12} more updates`)
}

async function loadFromDb(pool: Pool) {
  const { rows } = await pool.query(`
    SELECT p.id::text AS id, p.sku, p.name, COALESCE(p.description, '') AS description
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.is_active AND c.name = 'Laptops'
    ORDER BY p.name
  `)
  return rows as Array<{ id: string; sku: string; name: string; description: string }>
}

async function applyUpdates(pool: Pool, updates: PlanRow[]) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    for (const row of updates) {
      await client.query(
        'UPDATE products SET description = $2, updated_at = NOW() WHERE id = $1::uuid',
        [row.id, row.next],
      )
    }
    const blob = await client.query(`SELECT value FROM app_state WHERE key = 'deed_products'`)
    if (blob.rows[0]?.value) {
      const products = JSON.parse(blob.rows[0].value)
      if (Array.isArray(products)) {
        const byId = new Map(updates.map(u => [u.id, u.next]))
        const bySku = new Map(updates.map(u => [u.sku, u.next]))
        let touched = 0
        for (const product of products) {
          const next =
            byId.get(String(product.id || '')) ||
            bySku.get(String(product.sku || product.code || ''))
          if (next == null) continue
          product.description = next
          touched += 1
        }
        if (touched) {
          await client.query(
            `INSERT INTO app_state (key, value, updated_at)
             VALUES ('deed_products', $1, NOW()::text)
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
            [JSON.stringify(products)],
          )
        }
        console.log(JSON.stringify({ prismaUpdated: updates.length, blobUpdated: touched }))
      }
    } else {
      console.log(JSON.stringify({ prismaUpdated: updates.length, blobUpdated: 0 }))
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

async function main() {
  const csvPath = arg('--from-csv')
  const apply = process.argv.includes('--apply')
  let items: Array<{ id: string; sku: string; name: string; description: string }>
  if (csvPath) {
    const rows = parseCsv(readFileSync(csvPath, 'utf8'))
    rows.shift()
    items = rows.map(r => ({ id: r[0], sku: r[1], name: r[2], description: r[3] }))
  } else {
    const connectionString = process.env.deed_erp_POSTGRES_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL
    if (!connectionString) {
      console.error('Pass --from-csv or set DATABASE_URL')
      process.exit(1)
    }
    const pool = new Pool({ connectionString })
    items = await loadFromDb(pool)
    const planned = planRows(items)
    printSummary(planned)
    if (apply) {
      const updates = planned.filter(r => r.action === 'update' && r.next)
      await applyUpdates(pool, updates)
    }
    await pool.end()
    return
  }
  const planned = planRows(items)
  printSummary(planned)
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
