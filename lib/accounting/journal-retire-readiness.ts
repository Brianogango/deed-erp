/**
 * Journal retire readiness (Finance Phase 10 follow-up).
 * Pure checklist — blocks premature DELETE of live deed_journalEntries.
 * Certify ≠ archive ≠ retire. Store still blob-writes journals today.
 */

export type JournalRetireBlocker = {
  code: string
  message: string
}

export type JournalRetireReadinessInput = {
  /** Deep parity from Phase 9 (ref coverage + amount sample). */
  deepParityOk: boolean
  deepParityReason?: string | null
  certificateStatus?: string | null
  certificateParityOk?: boolean | null
  archiveKey?: string | null
  /**
   * When true, client/store still treats blob as write SoT for journals.
   * Remains true until a future cutover migrates writers off deed_journalEntries.
   */
  storeStillBlobWrites?: boolean
  /** Engine flag — retiring blob while engine is off leaves writers without Prisma path. */
  postingEngineEnabled?: boolean
  /** Explicit Director override after writers are migrated (default false). */
  writersMigratedOffBlob?: boolean
}

export type JournalRetireReadiness = {
  blobKey: 'deed_journalEntries'
  retireReady: boolean
  blockers: JournalRetireBlocker[]
  checklist: Array<{ id: string; ok: boolean; detail: string }>
  note: string
}

export function evaluateJournalRetireReadiness(
  input: JournalRetireReadinessInput,
): JournalRetireReadiness {
  const blockers: JournalRetireBlocker[] = []
  const checklist: JournalRetireReadiness['checklist'] = []

  const deepOk = input.deepParityOk === true
  checklist.push({
    id: 'deep_parity',
    ok: deepOk,
    detail: deepOk
      ? 'Journal ref deep parity OK (blob ⊆ Prisma)'
      : (input.deepParityReason || 'Deep parity not OK'),
  })
  if (!deepOk) {
    blockers.push({
      code: 'deep_parity',
      message: input.deepParityReason || 'Re-run journal parity before retire',
    })
  }

  const status = String(input.certificateStatus || '')
  const certOk = (status === 'certified' || status === 'archived') && input.certificateParityOk === true
  checklist.push({
    id: 'certificate',
    ok: certOk,
    detail: certOk
      ? `Certificate status=${status}`
      : `Need certified/archived certificate with parityOk (status=${status || 'none'})`,
  })
  if (!certOk) {
    blockers.push({
      code: 'certificate',
      message: 'Certify deed_journalEntries after deep parity, then archive',
    })
  }

  const archived = status === 'archived' && Boolean(input.archiveKey)
  checklist.push({
    id: 'archive_copy',
    ok: archived,
    detail: archived
      ? `Archive copy at ${input.archiveKey}`
      : 'Archive live key to archive:deed_journalEntries:… first',
  })
  if (!archived) {
    blockers.push({
      code: 'archive_copy',
      message: 'Archive copy required before retiring the live key',
    })
  }

  const storeBlob = input.storeStillBlobWrites !== false
  const writersMigrated = input.writersMigratedOffBlob === true
  const writersOk = writersMigrated || !storeBlob
  checklist.push({
    id: 'writers_off_blob',
    ok: writersOk,
    detail: writersOk
      ? 'Journal writers migrated off blob SoT'
      : 'Store still blob-writes deed_journalEntries — migrate writers before retire',
  })
  if (!writersOk) {
    blockers.push({
      code: 'writers_off_blob',
      message:
        'Client store still writes deed_journalEntries; retiring the live key would empty operational journals',
    })
  }

  const engineOn = input.postingEngineEnabled === true
  checklist.push({
    id: 'engine_or_prisma_writers',
    ok: writersOk || engineOn,
    detail: engineOn
      ? 'ACCOUNTING_POSTING_ENGINE is on (Prisma dual-write paths active)'
      : writersOk
        ? 'Writers off blob'
        : 'Engine off and store still blob-first — soak engine or migrate writers first',
  })
  // Do not add a separate blocker if writers_off_blob already blocks — engine soak is advisory
  // unless writers are claimed migrated while engine is off (inconsistent).
  if (writersMigrated && !engineOn && storeBlob) {
    blockers.push({
      code: 'engine_off',
      message: 'Writers marked migrated but engine is off and storeStillBlobWrites is still true',
    })
  }

  return {
    blobKey: 'deed_journalEntries',
    retireReady: blockers.length === 0,
    blockers,
    checklist,
    note:
      'Certify ≠ archive ≠ retire. Retire deletes the live app_state key only after readiness passes. Default storeStillBlobWrites=true keeps retireReady=false until a future writer cutover.',
  }
}

/** Gate used by blob-cutover retire action for journals. */
export function canRetireJournalLiveKey(input: JournalRetireReadinessInput): boolean {
  return evaluateJournalRetireReadiness(input).retireReady
}
