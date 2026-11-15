import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildExportRows } from '@/lib/data-table/export-rows'
import type { ColumnDef } from '@/lib/data-table/types'

type Row = { id: string; name: string; amount: number }
const rows: Row[] = Array.from({ length: 200 }, (_, i) => ({ id: `r${i}`, name: `Row ${i}`, amount: i * 10 }))

describe('export rows', () => {
  it('writes one cell per column, taking the export value over the rendered one', () => {
    const columns = [
      { key: 'name', label: 'Name', priority: 'high', render: (r: Row) => r.name },
      { key: 'amount', label: 'Amount', priority: 'high', render: () => 'KES —', exportValue: (r: Row) => r.amount },
    ] as unknown as ColumnDef<Row>[]
    expect(buildExportRows(rows.slice(0, 2), columns)).toEqual([
      ['Row 0', 0],
      ['Row 1', 10],
    ])
  })

  it('reads every row exactly once per column', () => {
    let reads = 0
    const columns = [
      { key: 'name', label: 'Name', priority: 'high', render: (r: Row) => { reads += 1; return r.name } },
      { key: 'amount', label: 'Amount', priority: 'high', render: (r: Row) => { reads += 1; return String(r.amount) } },
    ] as unknown as ColumnDef<Row>[]
    buildExportRows(rows, columns)
    expect(reads).toBe(200 * 2)
  })

  // That cost belongs to the click that asks for a file, not to every render of
  // the table: a column without an accessor falls back to render(), so building
  // the matrix up front made a React element per row per column on every
  // keystroke in the search box.
  it('is only called from the export menu, never while rendering', () => {
    const source = readFileSync('components/data-table/DataTable.tsx', 'utf8')
    const calls = [...source.matchAll(/^.*\bexportRows\(\).*$/gm)].map(m => m[0])
    expect(calls.length).toBeGreaterThan(0)
    for (const line of calls) expect(line).toContain('onSelect:')
    expect(source).toContain('const exportRows = useCallback(')
  })
})
