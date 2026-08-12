#!/usr/bin/env node
/**
 * Apply additive sales inbound email pipeline migration (safe / re-runnable).
 * Usage (Contabo as postgres OS user or with DATABASE_URL):
 *   node scripts/run-safe-sales-inbound-email-pipeline.mjs
 */
const { readFileSync } = require('fs')
const { join } = require('path')
const { Client } = require('pg')

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('DATABASE_URL required')
    process.exit(1)
  }
  const sql = readFileSync(
    join(__dirname, '../database/migrations/20260812_sales_inbound_email_pipeline_safe.sql'),
    'utf8',
  )
  const client = new Client({ connectionString: url })
  await client.connect()
  try {
    await client.query(sql)
    console.log('OK: sales inbound email pipeline migration applied')
  } finally {
    await client.end()
  }
}

main().catch(err => {
  console.error(err.message || err)
  process.exit(1)
})
