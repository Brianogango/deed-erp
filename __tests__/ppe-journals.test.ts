import { describe, expect, it } from 'vitest'
import {
  buildCapitaliseFromApJournal,
  buildCapitaliseFromInventoryJournal,
  buildDepreciationJournal,
  buildDisposalJournal,
  capitaliseJournalRef,
  depreciationJournalRef,
} from '@/lib/accounting/ppe-journals'

const furniture = {
  ref: 'AST/2026/0008',
  name: 'Boardroom table',
  costKes: 45000,
  accumDeprKes: 5000,
  qty: 1,
  ppeAccountCode: '1702',
  supplierName: 'Woodworks',
  serialNumber: 'SN-1',
}

function balanced(lines: Array<{ debit: number; credit: number }>) {
  const dr = lines.reduce((s, l) => s + l.debit, 0)
  const cr = lines.reduce((s, l) => s + l.credit, 0)
  return Math.round(dr * 100) === Math.round(cr * 100)
}

describe('PPE journals', () => {
  it('capitalises a purchase to PPE and AP, never inventory 1200', () => {
    const j = buildCapitaliseFromApJournal(furniture, '2026-08-01')
    expect(j?.ref).toBe(capitaliseJournalRef(furniture.ref))
    expect(j?.lines.some(l => l.account.includes('1702') && l.debit === 45000)).toBe(true)
    expect(j?.lines.some(l => l.account.includes('3000') && l.credit === 45000)).toBe(true)
    expect(j?.lines.some(l => l.account.includes('1200'))).toBe(false)
    expect(balanced(j!.lines)).toBe(true)
  })

  it('capitalises a demo serial Dr PPE / Cr inventory 1200', () => {
    const j = buildCapitaliseFromInventoryJournal(furniture, '2026-08-01')
    expect(j?.lines.some(l => l.account.includes('1702') && l.debit === 45000)).toBe(true)
    expect(j?.lines.some(l => l.account.includes('1200') && l.credit === 45000)).toBe(true)
    expect(balanced(j!.lines)).toBe(true)
  })

  it('posts one monthly depreciation journal Dr 6517 / Cr 175x', () => {
    const j = buildDepreciationJournal('2026-08', [
      { asset: furniture, amount: 1000 },
      { asset: { ...furniture, ref: 'AST/2026/0009', ppeAccountCode: '1701' }, amount: 500 },
    ], '2026-08-31')
    expect(j?.ref).toBe(depreciationJournalRef('2026-08'))
    expect(j?.lines.find(l => l.account.includes('6517'))?.debit).toBe(1500)
    expect(j?.lines.find(l => l.account.includes('1752'))?.credit).toBe(1000)
    expect(j?.lines.find(l => l.account.includes('1751'))?.credit).toBe(500)
    expect(balanced(j!.lines)).toBe(true)
  })

  it('disposes with gain: Dr cash + accum, Cr cost + 5203', () => {
    const j = buildDisposalJournal(furniture, 1, 50000, '2026-08-26')
    expect(j?.lines.find(l => l.account.includes('2211'))?.debit).toBe(50000)
    expect(j?.lines.find(l => l.account.includes('1752'))?.debit).toBe(5000)
    expect(j?.lines.find(l => l.account.includes('1702'))?.credit).toBe(45000)
    expect(j?.lines.find(l => l.account.includes('5203'))?.credit).toBe(10000)
    expect(balanced(j!.lines)).toBe(true)
  })

  it('disposes with loss: Dr 6515 when proceeds are below NBV', () => {
    const j = buildDisposalJournal(furniture, 1, 0, '2026-08-26')
    expect(j?.lines.find(l => l.account.includes('6515'))?.debit).toBe(40000)
    expect(j?.lines.find(l => l.account.includes('5203'))).toBeUndefined()
    expect(j?.lines.find(l => l.account.includes('1702'))?.credit).toBe(45000)
    expect(balanced(j!.lines)).toBe(true)
  })
})
