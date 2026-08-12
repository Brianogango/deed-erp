import { describe, expect, it } from 'vitest'
import {
  blobJournalTotals,
  compareJournalRefSets,
  evaluateJournalDeepParity,
  extractJournalRefs,
  sampleJournalAmountDrift,
} from '@/lib/accounting/journal-parity'
import { canCertify, evaluateParity } from '@/lib/blob-cutover'

describe('journal parity helpers', () => {
  it('extracts unique refs from blob JSON', () => {
    const raw = JSON.stringify([
      { ref: 'JRN/A', totalDebit: 10, totalCredit: 10 },
      { ref: 'JRN/B', totalDebit: 5, totalCredit: 5 },
      { ref: 'JRN/A', totalDebit: 10, totalCredit: 10 },
      { id: 'no-ref' },
    ])
    expect(extractJournalRefs(raw)).toEqual(['JRN/A', 'JRN/B'])
  })

  it('treats empty sets as ok', () => {
    const cmp = compareJournalRefSets([], [])
    expect(cmp.ok).toBe(true)
    expect(cmp.coveragePct).toBe(1)
  })

  it('flags blob-only refs and allows prisma-ahead', () => {
    const cmp = compareJournalRefSets(['JRN/1', 'JRN/2'], ['JRN/1', 'JRN/2', 'JRN/STK/1'])
    expect(cmp.ok).toBe(true)
    expect(cmp.matched).toBe(2)
    expect(cmp.prismaOnlySample).toContain('JRN/STK/1')

    const gap = compareJournalRefSets(['JRN/1', 'JRN/MISSING'], ['JRN/1'])
    expect(gap.ok).toBe(false)
    expect(gap.blobOnlyRefs).toEqual(['JRN/MISSING'])
  })

  it('samples amount drift on overlapping refs', () => {
    const drift = sampleJournalAmountDrift(
      [
        { ref: 'JRN/1', totalDebit: 100, totalCredit: 100 },
        { ref: 'JRN/2', totalDebit: 50, totalCredit: 50 },
      ],
      new Map([
        ['JRN/1', { debit: 100, credit: 100 }],
        ['JRN/2', { debit: 40, credit: 40 }],
      ]),
    )
    expect(drift.sampled).toBe(2)
    expect(drift.mismatched).toBe(1)
    expect(drift.ok).toBe(false)
    expect(blobJournalTotals({ lines: [{ debit: 10, credit: 0 }, { debit: 0, credit: 10 }] })).toEqual({
      debit: 10,
      credit: 10,
    })
  })

  it('evaluateJournalDeepParity requires full blob ⊆ Prisma and no amount drift', () => {
    const blob = JSON.stringify([
      { ref: 'JRN/1', totalDebit: 100, totalCredit: 100 },
      { ref: 'JRN/2', totalDebit: 20, totalCredit: 20 },
    ])
    const ok = evaluateJournalDeepParity({
      blobRaw: blob,
      prismaRefs: ['JRN/1', 'JRN/2', 'JRN/STK'],
      prismaTotalsByRef: new Map([
        ['JRN/1', { debit: 100, credit: 100 }],
        ['JRN/2', { debit: 20, credit: 20 }],
      ]),
      prismaCount: 3,
    })
    expect(ok.ok).toBe(true)

    const missing = evaluateJournalDeepParity({
      blobRaw: blob,
      prismaRefs: ['JRN/1'],
      prismaCount: 1,
    })
    expect(missing.ok).toBe(false)
    expect(missing.blockedReason).toMatch(/ref gap/i)

    const drifted = evaluateJournalDeepParity({
      blobRaw: blob,
      prismaRefs: ['JRN/1', 'JRN/2'],
      prismaTotalsByRef: new Map([
        ['JRN/1', { debit: 100, credit: 100 }],
        ['JRN/2', { debit: 1, credit: 1 }],
      ]),
      prismaCount: 2,
    })
    expect(drifted.ok).toBe(false)
    expect(drifted.blockedReason).toMatch(/amount drift/i)
  })
})

describe('journal cutover gate', () => {
  it('allows prisma-ahead counts for deed_journalEntries', () => {
    const check = evaluateParity({
      blobKey: 'deed_journalEntries',
      prismaTable: 'journal_entries',
      blobCount: 10,
      prismaCount: 25,
      domainRole: 'dual_write',
      allowPrismaAhead: true,
    })
    expect(check.parityOk).toBe(true)
  })

  it('canCertify requires parityOk', () => {
    expect(canCertify({
      blobKey: 'deed_journalEntries',
      prismaTable: 'journal_entries',
      blobCount: 10,
      prismaCount: 25,
      parityOk: true,
      domainRole: 'dual_write',
    })).toBe(true)
    expect(canCertify({
      blobKey: 'deed_journalEntries',
      prismaTable: 'journal_entries',
      blobCount: 10,
      prismaCount: 8,
      parityOk: false,
      domainRole: 'dual_write',
      blockedReason: 'Journal ref gap',
    })).toBe(false)
  })
})
