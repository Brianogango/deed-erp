import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const schema = readFileSync('prisma/schema.prisma', 'utf8')
const serverStore = readFileSync('lib/server-store.ts', 'utf8')
const migration = readFileSync('database/migrations/20260920_erp_state_prisma_cutover.sql', 'utf8')

describe('Prisma shared-state cutover', () => {
  it('stores collection metadata and individual business records in Prisma models', () => {
    expect(schema).toContain('model ErpStateKey')
    expect(schema).toContain('model ErpStateRecord')
    expect(schema).toContain('@@unique([key, recordKey]')
  })

  it('does not write structured ERP payloads back to app_state', () => {
    expect(serverStore).toContain('savePrismaStateEntries(structuredEntries)')
    expect(serverStore).toContain("process.env.NODE_ENV === 'test'")
    expect(serverStore).toContain("pg_notify('app_state_changed'")
  })

  it('keeps the database migration additive and indexed', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS erp_state_keys')
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS erp_state_records')
    expect(migration).toContain('idx_erp_state_records_order')
    expect(migration).not.toMatch(/DROP\s+TABLE|DELETE\s+FROM\s+app_state/i)
  })
})
