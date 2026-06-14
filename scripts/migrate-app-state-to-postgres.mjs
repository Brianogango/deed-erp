#!/usr/bin/env node
import dotenv from 'dotenv'
import pg from 'pg'

const { Pool } = pg
dotenv.config({ path: '.env.production' })
dotenv.config({ path: '.env', override: false })

const apply = process.argv.includes('--apply')
const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL

if (!connectionString) {
  console.error('Set DATABASE_URL or POSTGRES_URL')
  process.exit(2)
}

const pool = new Pool({
  connectionString,
  ssl: /localhost|127\.0\.0\.1/.test(connectionString) ? false : { rejectUnauthorized: false },
})

const keys = [
  'deed_payments',
  'deed_journalEntries',
  'deed_contacts',
  'deed_repairs_v2',
]

function parseJson(value, fallback) {
  if (Array.isArray(value)) return value
  if (typeof value !== 'string') return fallback
  try { return JSON.parse(value) } catch { return fallback }
}

async function loadAppState() {
  const { rows } = await pool.query('select key, value from app_state where key = any($1)', [keys])
  return Object.fromEntries(rows.map(row => [row.key, parseJson(row.value, [])]))
}

async function ensureTables() {
  await pool.query(`
    create table if not exists legacy_payments (
      id text primary key,
      ref text,
      customer_name text,
      amount numeric(14,2),
      method text,
      status text,
      payload jsonb not null,
      migrated_at timestamptz not null default now()
    );
    create table if not exists legacy_journal_entries (
      id text primary key,
      ref text,
      date text,
      source text,
      payload jsonb not null,
      migrated_at timestamptz not null default now()
    );
    create table if not exists legacy_contacts (
      id text primary key,
      name text,
      email text,
      phone text,
      payload jsonb not null,
      migrated_at timestamptz not null default now()
    );
    create table if not exists legacy_repairs (
      id text primary key,
      ref text unique,
      customer_name text,
      status text,
      payload jsonb not null,
      migrated_at timestamptz not null default now()
    );
  `)
}

async function upsertRows(table, rows, mapper) {
  for (const row of rows) {
    const mapped = mapper(row)
    await pool.query(mapped.sql, mapped.values)
  }
}

async function main() {
  const state = await loadAppState()
  const payments = state.deed_payments ?? []
  const journals = state.deed_journalEntries ?? []
  const contacts = state.deed_contacts ?? []
  const repairs = state.deed_repairs_v2 ?? []

  const summary = {
    apply,
    payments: payments.length,
    journals: journals.length,
    contacts: contacts.length,
    repairs: repairs.length,
  }
  console.log(JSON.stringify(summary, null, 2))

  if (!apply) {
    console.log('Dry run only. Re-run with --apply to create staging tables and upsert rows.')
    return
  }

  await ensureTables()
  await upsertRows('legacy_payments', payments, p => ({
    sql: `insert into legacy_payments (id, ref, customer_name, amount, method, status, payload)
          values ($1,$2,$3,$4,$5,$6,$7)
          on conflict (id) do update set ref=excluded.ref, customer_name=excluded.customer_name, amount=excluded.amount, method=excluded.method, status=excluded.status, payload=excluded.payload, migrated_at=now()`,
    values: [String(p.id), p.ref ?? null, p.customerName ?? null, Number(p.amount ?? 0), p.method ?? null, p.status ?? null, p],
  }))
  await upsertRows('legacy_journal_entries', journals, j => ({
    sql: `insert into legacy_journal_entries (id, ref, date, source, payload)
          values ($1,$2,$3,$4,$5)
          on conflict (id) do update set ref=excluded.ref, date=excluded.date, source=excluded.source, payload=excluded.payload, migrated_at=now()`,
    values: [String(j.id), j.ref ?? null, j.date ?? null, j.source ?? null, j],
  }))
  await upsertRows('legacy_contacts', contacts, c => ({
    sql: `insert into legacy_contacts (id, name, email, phone, payload)
          values ($1,$2,$3,$4,$5)
          on conflict (id) do update set name=excluded.name, email=excluded.email, phone=excluded.phone, payload=excluded.payload, migrated_at=now()`,
    values: [String(c.id), c.name ?? null, c.email ?? null, c.phone ?? null, c],
  }))
  await upsertRows('legacy_repairs', repairs, r => ({
    sql: `insert into legacy_repairs (id, ref, customer_name, status, payload)
          values ($1,$2,$3,$4,$5)
          on conflict (id) do update set ref=excluded.ref, customer_name=excluded.customer_name, status=excluded.status, payload=excluded.payload, migrated_at=now()`,
    values: [String(r.id), r.ref ?? null, r.customerName ?? null, r.status ?? null, r],
  }))
  console.log('Migration staging complete.')
}

main().finally(() => pool.end())
