import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { prismaPgConfig } from '@/lib/prisma-pg-config'
import { parsePrismaDateTimeColumns, PRISMA_ONLY_TABLES, MIXED_WRITER_TABLES } from '../scripts/fix-prisma-timestamptz-offset.mjs'

describe('Prisma sessions are pinned to UTC', () => {
  it('passes TimeZone=UTC as a startup option on every Prisma pool', () => {
    expect(prismaPgConfig('postgresql://u:p@h/db')).toEqual({
      connectionString: 'postgresql://u:p@h/db',
      options: '-c TimeZone=UTC',
    })
  })

  it('both Prisma clients use the shared config', () => {
    for (const file of ['lib/prisma.ts', 'lib/infra/reporting-db.ts']) {
      const src = fs.readFileSync(file, 'utf8')
      expect(src).toContain('new PrismaPg(prismaPgConfig(connectionString))')
      expect(src).not.toMatch(/new PrismaPg\(\{\s*connectionString\s*\}\)/)
    }
  })
})

describe('timestamptz correction script', () => {
  const schema = fs.readFileSync('prisma/schema.prisma', 'utf8')
  const cols = parsePrismaDateTimeColumns(schema)

  it('maps Prisma DateTime fields to their database columns', () => {
    expect(cols.get('deposits')?.get('created_at')).toEqual({ field: 'createdAt', prismaSets: true })
    expect(cols.get('deposits')?.get('updated_at')).toEqual({ field: 'updatedAt', prismaSets: true })
    expect(cols.get('holdovers')?.get('issued_at')).toEqual({ field: 'issuedAt', prismaSets: false })
  })

  it('never lists a table as both Prisma-only and mixed', () => {
    for (const t of PRISMA_ONLY_TABLES) expect(MIXED_WRITER_TABLES).not.toHaveProperty(t)
  })

  it('every Prisma-only table is a real Prisma model', () => {
    for (const t of PRISMA_ONLY_TABLES) expect(cols.has(t), t).toBe(true)
  })
})
