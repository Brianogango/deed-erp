import { beforeEach, describe, expect, it } from 'vitest'
import {
  canRetireJournalLiveKey,
  evaluateJournalRetireReadiness,
} from '@/lib/accounting/journal-retire-readiness'
import {
  buildPostingEngineSoakReport,
  POSTING_ENGINE_SURFACES,
} from '@/lib/accounting/posting-soak'

beforeEach(() => {
  delete process.env.ACCOUNTING_POSTING_ENGINE
})

describe('journal retire readiness', () => {
  it('blocks retire while store still blob-writes journals', () => {
    const r = evaluateJournalRetireReadiness({
      deepParityOk: true,
      certificateStatus: 'archived',
      certificateParityOk: true,
      archiveKey: 'archive:deed_journalEntries:2026',
      storeStillBlobWrites: true,
      postingEngineEnabled: false,
      writersMigratedOffBlob: false,
    })
    expect(r.retireReady).toBe(false)
    expect(r.blockers.some(b => b.code === 'writers_off_blob')).toBe(true)
    expect(canRetireJournalLiveKey({
      deepParityOk: true,
      certificateStatus: 'archived',
      certificateParityOk: true,
      archiveKey: 'archive:deed_journalEntries:2026',
      storeStillBlobWrites: true,
    })).toBe(false)
  })

  it('requires deep parity, certificate, and archive', () => {
    const r = evaluateJournalRetireReadiness({
      deepParityOk: false,
      deepParityReason: 'ref gap',
      certificateStatus: 'verified',
      certificateParityOk: true,
      storeStillBlobWrites: false,
      writersMigratedOffBlob: true,
    })
    expect(r.retireReady).toBe(false)
    expect(r.blockers.map(b => b.code)).toEqual(
      expect.arrayContaining(['deep_parity', 'certificate', 'archive_copy']),
    )
  })

  it('allows retire only when writers migrated and archive exists', () => {
    const r = evaluateJournalRetireReadiness({
      deepParityOk: true,
      certificateStatus: 'archived',
      certificateParityOk: true,
      archiveKey: 'archive:deed_journalEntries:ok',
      storeStillBlobWrites: false,
      writersMigratedOffBlob: true,
      postingEngineEnabled: true,
    })
    expect(r.retireReady).toBe(true)
    expect(r.blockers).toHaveLength(0)
  })
})

describe('posting engine soak', () => {
  it('reports default off and wired surfaces', () => {
    const report = buildPostingEngineSoakReport()
    expect(report.enabled).toBe(false)
    expect(report.defaultOff).toBe(true)
    expect(report.surfaces.length).toBe(POSTING_ENGINE_SURFACES.length)
    expect(report.builderSelfCheck.ok).toBe(true)
    expect(report.note).toMatch(/never enables/i)
  })

  it('reflects enabled flag when set', () => {
    process.env.ACCOUNTING_POSTING_ENGINE = 'true'
    const report = buildPostingEngineSoakReport()
    expect(report.enabled).toBe(true)
    expect(report.guidance.some(g => /Flag is ON/i.test(g))).toBe(true)
  })
})
