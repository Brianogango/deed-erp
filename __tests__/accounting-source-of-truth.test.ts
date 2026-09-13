import { afterEach, describe, expect, it } from 'vitest'
import {
  accountingCutoverState,
  accountingReportSourceOfTruth,
  journalWritersMigratedOffBlob,
  storeStillWritesJournalBlob,
} from '@/lib/accounting/source-of-truth'

const original = process.env.ACCOUNTING_PRISMA_JOURNAL_WRITERS

afterEach(() => {
  if (original === undefined) delete process.env.ACCOUNTING_PRISMA_JOURNAL_WRITERS
  else process.env.ACCOUNTING_PRISMA_JOURNAL_WRITERS = original
})

describe('accounting source of truth', () => {
  it('uses Prisma for every financial report', () => {
    expect(accountingReportSourceOfTruth()).toBe('prisma')
  })

  it('keeps the compatibility blob until writer cutover is explicit', () => {
    delete process.env.ACCOUNTING_PRISMA_JOURNAL_WRITERS
    expect(journalWritersMigratedOffBlob()).toBe(false)
    expect(storeStillWritesJournalBlob()).toBe(true)
    expect(accountingCutoverState()).toEqual({
      reportSource: 'prisma',
      writersMigratedOffBlob: false,
      storeStillBlobWrites: true,
    })
  })

  it.each(['1', 'true', 'on', 'yes'])('recognises explicit writer cutover value %s', value => {
    process.env.ACCOUNTING_PRISMA_JOURNAL_WRITERS = value
    expect(journalWritersMigratedOffBlob()).toBe(true)
    expect(storeStillWritesJournalBlob()).toBe(false)
  })

  it('does not treat an arbitrary value as cutover authority', () => {
    process.env.ACCOUNTING_PRISMA_JOURNAL_WRITERS = 'enabled'
    expect(journalWritersMigratedOffBlob()).toBe(false)
  })
})
