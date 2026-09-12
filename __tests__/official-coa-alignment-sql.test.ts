import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  join(process.cwd(), 'database/migrations/20260828_official_coa_alignment_safe.sql'),
  'utf8',
)

const RENUMBER_UPDATES = [
  { from: '6201', to: '6601' },
  { from: '6202', to: '6606' },
  { from: '6203', to: '6609' },
  { from: '6200', to: '6305' },
  { from: '6205', to: '6306' },
  { from: '6210', to: '6307' },
  { from: '6401', to: '6703' },
  { from: '6405', to: '6518' },
  { from: '6430', to: '6511' },
  { from: '6495', to: '6595' },
  { from: '6499', to: '6599' },
  { from: '3305', to: '3302' },
  { from: '3306', to: '3303' },
  { from: '3307', to: '3304' },
  { from: '3308', to: '3305' },
  { from: '3309', to: '3306' },
  { from: '3110', to: '3310' },
  { from: '3105', to: '3312' },
  { from: '3102', to: '3313' },
  { from: '3005', to: '3202' },
  { from: '1805', to: '1933' },
  { from: '1810', to: '1931' },
  { from: '5003', to: '5101' },
  { from: '5105', to: '5201' },
  { from: '6108', to: '6114' },
]

describe('migration 20260828_official_coa_alignment_safe.sql', () => {
  it('skips dest-code renames when the official code already exists', () => {
    const updates = [...sql.matchAll(/UPDATE account_codes SET code = '(\d+)'[\s\S]*?;/g)]
    expect(updates.length).toBe(RENUMBER_UPDATES.length)

    for (const { from, to } of RENUMBER_UPDATES) {
      const stmt = updates
        .map((match) => match[0])
        .find((chunk) => chunk.includes(`SET code = '${to}'`) && chunk.includes(`WHERE code = '${from}'`))
      expect(stmt, `missing ${from} → ${to} rename`).toBeTruthy()
      expect(stmt).toContain(`AND NOT EXISTS (SELECT 1 FROM account_codes WHERE code = '${to}')`)
    }
  })

  it('inserts official accounts only when the code is missing', () => {
    expect(sql).toMatch(/WHERE NOT EXISTS \(\s*SELECT 1 FROM account_codes a WHERE a\.code = v\.code\s*\)/)
  })
})
