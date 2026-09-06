import { describe, expect, it } from 'vitest'
import {
  canApplyPolledRepair,
  isDeedRepairsBlobDirty,
  refurbishmentJobHref,
  repairDetailPanel,
  resolveRepairWorkspaceId,
} from '@/lib/repair-open-record'

describe('resolveRepairWorkspaceId', () => {
  it('returns none when no id is open', () => {
    expect(resolveRepairWorkspaceId(null, ['rep-1'], ['ref-1'])).toBe('none')
    expect(resolveRepairWorkspaceId('', ['rep-1'], ['ref-1'])).toBe('none')
  })

  it('prefers a repair order when both collections somehow share an id', () => {
    expect(resolveRepairWorkspaceId('same', ['same'], ['same'])).toBe('repair')
  })

  it('recognises a refurbishment job id that is not a repair', () => {
    expect(resolveRepairWorkspaceId('job-9', ['rep-1'], ['job-9'])).toBe('refurb')
  })

  it('marks unknown ids so the workspace can show a missing state', () => {
    expect(resolveRepairWorkspaceId('ghost', ['rep-1'], ['job-9'])).toBe('unknown')
  })
})

describe('refurbishmentJobHref', () => {
  it('opens the Refurbishment module on that job', () => {
    expect(refurbishmentJobHref('job/1')).toBe('/refurbishment?id=job%2F1')
  })
})

describe('isDeedRepairsBlobDirty', () => {
  it('is false for empty or invalid dirty-key snapshots', () => {
    expect(isDeedRepairsBlobDirty(null)).toBe(false)
    expect(isDeedRepairsBlobDirty('')).toBe(false)
    expect(isDeedRepairsBlobDirty('not-json')).toBe(false)
    expect(isDeedRepairsBlobDirty('["deed_contacts"]')).toBe(false)
  })

  it('is true only when the repairs blob itself is dirty', () => {
    expect(isDeedRepairsBlobDirty('["deed_repairs_v2","deed_contacts"]')).toBe(true)
  })
})

describe('canApplyPolledRepair', () => {
  it('drops the poll while local repairs are unsynced', () => {
    expect(canApplyPolledRepair({
      repairsBlobDirty: true,
      localGeneration: 2,
      fetchGeneration: 2,
    })).toBe(false)
  })

  it('drops an in-flight poll that started before the last local mutation', () => {
    expect(canApplyPolledRepair({
      repairsBlobDirty: false,
      localGeneration: 4,
      fetchGeneration: 3,
    })).toBe(false)
  })

  it('applies a poll that matches the current local generation', () => {
    expect(canApplyPolledRepair({
      repairsBlobDirty: false,
      localGeneration: 4,
      fetchGeneration: 4,
    })).toBe(true)
  })
})

describe('repairDetailPanel', () => {
  it('hides the panel on list and intake', () => {
    expect(repairDetailPanel({ view: 'list', hasActiveRepair: false, lookup: 'loading' })).toBe('hidden')
    expect(repairDetailPanel({ view: 'intake', hasActiveRepair: false, lookup: 'missing' })).toBe('hidden')
  })

  it('shows the job card when the repair resolved', () => {
    expect(repairDetailPanel({ view: 'detail', hasActiveRepair: true, lookup: 'missing' })).toBe('detail')
  })

  it('shows loading then missing instead of a blank workspace', () => {
    expect(repairDetailPanel({ view: 'detail', hasActiveRepair: false, lookup: 'loading' })).toBe('loading')
    expect(repairDetailPanel({ view: 'detail', hasActiveRepair: false, lookup: 'missing' })).toBe('missing')
    expect(repairDetailPanel({ view: 'detail', hasActiveRepair: false, lookup: 'idle' })).toBe('missing')
  })
})
