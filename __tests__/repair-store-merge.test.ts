import { describe, it, expect } from 'vitest'
import {
  mergeRepairsStoreWrite,
  pickRepairStoreRow,
} from '@/lib/repair-store-merge'

describe('pickRepairStoreRow', () => {
  it('does not rewind a collected job to in_repair', () => {
    const current = { id: 'r1', status: 'collected', collectedDate: '2026-08-14', invoiceId: 'inv-1' }
    const incoming = { id: 'r1', status: 'in_repair' }
    const picked = pickRepairStoreRow(current, incoming)
    expect(picked.status).toBe('collected')
    expect(picked.collectedDate).toBe('2026-08-14')
    expect(picked.invoiceId).toBe('inv-1')
  })

  it('does not rewind ready / invoiced / verified_released', () => {
    expect(pickRepairStoreRow({ id: 'a', status: 'ready' }, { id: 'a', status: 'qc' }).status).toBe('ready')
    expect(pickRepairStoreRow({ id: 'a', status: 'invoiced', invoiceId: 'i1' }, { id: 'a', status: 'ready' }).status).toBe('invoiced')
    expect(pickRepairStoreRow({ id: 'a', status: 'verified_released' }, { id: 'a', status: 'assigned' }).status).toBe('verified_released')
  })

  it('allows forward progress onto a finalised job', () => {
    expect(pickRepairStoreRow({ id: 'a', status: 'ready' }, { id: 'a', status: 'invoiced', invoiceId: 'i1' }).status).toBe('invoiced')
    expect(pickRepairStoreRow({ id: 'a', status: 'verified_released' }, { id: 'a', status: 'collected', collectedDate: 'x' }).status).toBe('collected')
  })

  it('pins terminal statuses against an in-progress rewind', () => {
    expect(pickRepairStoreRow({ id: 'a', status: 'cancelled' }, { id: 'a', status: 'received' }).status).toBe('cancelled')
    expect(pickRepairStoreRow({ id: 'a', status: 'unrepairable' }, { id: 'a', status: 'in_repair' }).status).toBe('unrepairable')
    expect(pickRepairStoreRow({ id: 'a', status: 'retained' }, { id: 'a', status: 'ready' }).status).toBe('retained')
  })

  it('allows in-progress Back and QC fail', () => {
    expect(pickRepairStoreRow({ id: 'a', status: 'in_repair' }, { id: 'a', status: 'assigned' }).status).toBe('assigned')
    expect(pickRepairStoreRow({ id: 'a', status: 'qc' }, { id: 'a', status: 'in_repair' }).status).toBe('in_repair')
  })

  it('allows ORC void: verified_released → ready', () => {
    const picked = pickRepairStoreRow(
      { id: 'a', status: 'verified_released', invoiceId: 'i1' },
      { id: 'a', status: 'ready' },
    )
    expect(picked.status).toBe('ready')
    expect(picked.invoiceId).toBe('i1')
  })

  it('keeps an invoice id when a later status write omits it', () => {
    const picked = pickRepairStoreRow(
      { id: 'a', status: 'invoiced', invoiceId: 'inv-keep' },
      { id: 'a', status: 'verified_released' },
    )
    expect(picked.status).toBe('verified_released')
    expect(picked.invoiceId).toBe('inv-keep')
  })
})

describe('mergeRepairsStoreWrite', () => {
  it('unions by id so omitted jobs are not dropped', () => {
    const current = [
      { id: 'done', status: 'collected', ref: 'REP-1' },
      { id: 'open', status: 'in_repair', ref: 'REP-2' },
    ]
    const incoming = [{ id: 'open', status: 'qc', ref: 'REP-2' }]
    const merged = mergeRepairsStoreWrite(current, incoming)
    expect(merged.map(r => r.id).sort()).toEqual(['done', 'open'])
    expect(merged.find(r => r.id === 'done')?.status).toBe('collected')
    expect(merged.find(r => r.id === 'open')?.status).toBe('qc')
  })

  it('does not let a full stale snapshot rewind finalised jobs', () => {
    const current = [
      { id: 'a', status: 'collected', collectedDate: '2026-08-14' },
      { id: 'b', status: 'ready' },
      { id: 'c', status: 'in_repair' },
    ]
    const incoming = [
      { id: 'a', status: 'diagnosed' },
      { id: 'b', status: 'assigned' },
      { id: 'c', status: 'assigned' },
    ]
    const merged = mergeRepairsStoreWrite(current, incoming)
    expect(merged.find(r => r.id === 'a')?.status).toBe('collected')
    expect(merged.find(r => r.id === 'b')?.status).toBe('ready')
    expect(merged.find(r => r.id === 'c')?.status).toBe('assigned')
  })

  it('keeps the server ledger when the client sends an empty array', () => {
    const current = [{ id: 'a', status: 'ready' }]
    expect(mergeRepairsStoreWrite(current, [])).toEqual(current)
  })

  it('accepts a brand-new repair the server has not seen', () => {
    const merged = mergeRepairsStoreWrite(
      [{ id: 'a', status: 'ready' }],
      [{ id: 'b', status: 'received', ref: 'REP-NEW' }],
    )
    expect(merged.map(r => r.id).sort()).toEqual(['a', 'b'])
  })

  it('does not let a stale collected snapshot rewrite the booked year', () => {
    const current = {
      id: 'a',
      status: 'collected',
      intakeDate: '2026-04-28T00:00:00.000Z',
      createdDate: '2026-04-28T00:00:00.000Z',
      date: '2026-04-28T00:00:00.000Z',
      collectedDate: '2026-08-05',
    }
    const incoming = {
      id: 'a',
      status: 'collected',
      intakeDate: '2091-04-28',
      createdDate: '2091-04-28',
      date: '2091-04-28',
      collectedDate: '2026-08-05',
    }
    const picked = pickRepairStoreRow(current, incoming)
    expect(picked.intakeDate).toBe('2026-04-28T00:00:00.000Z')
    expect(picked.createdDate).toBe('2026-04-28T00:00:00.000Z')
    expect(picked.date).toBe('2026-04-28T00:00:00.000Z')
    expect(picked.status).toBe('collected')
  })

  it('allows a same month-day year correction on a collected job (2091 → 2026)', () => {
    const current = {
      id: 'a',
      status: 'collected',
      intakeDate: '2091-04-28',
      createdDate: '2091-04-28',
      date: '2091-04-28',
      collectedDate: '2026-08-05',
    }
    const incoming = {
      id: 'a',
      status: 'collected',
      intakeDate: '2026-04-28T00:00:00.000Z',
      createdDate: '2026-04-28T00:00:00.000Z',
      date: '2026-04-28T00:00:00.000Z',
      collectedDate: '2026-08-05',
    }
    const picked = pickRepairStoreRow(current, incoming)
    expect(picked.intakeDate).toBe('2026-04-28T00:00:00.000Z')
    expect(picked.createdDate).toBe('2026-04-28T00:00:00.000Z')
    expect(picked.date).toBe('2026-04-28T00:00:00.000Z')
  })

  it('does not stamp today onto an out-of-bounds booked date', () => {
    const current = {
      id: 'a',
      status: 'collected',
      intakeDate: '2091-04-28',
      collectedDate: '2026-08-05',
    }
    const incoming = {
      id: 'a',
      status: 'collected',
      intakeDate: '2026-08-17T15:30:00.000Z',
      collectedDate: '2026-08-05',
    }
    const picked = pickRepairStoreRow(current, incoming)
    expect(picked.intakeDate).toBe('2091-04-28')
  })

  it('allows a single in-progress Back, but pins a stale snapshot that rewinds many open jobs', () => {
    const single = mergeRepairsStoreWrite(
      [{ id: 'open', status: 'diagnosed' }],
      [{ id: 'open', status: 'received' }],
    )
    expect(single.find(r => r.id === 'open')?.status).toBe('received')

    const stale = mergeRepairsStoreWrite(
      [
        { id: 'a', status: 'diagnosed' },
        { id: 'b', status: 'qc' },
        { id: 'c', status: 'assigned' },
      ],
      [
        { id: 'a', status: 'received' },
        { id: 'b', status: 'in_repair' },
        { id: 'c', status: 'received' },
      ],
    )
    expect(stale.find(r => r.id === 'a')?.status).toBe('diagnosed')
    expect(stale.find(r => r.id === 'b')?.status).toBe('qc')
    expect(stale.find(r => r.id === 'c')?.status).toBe('assigned')
  })
})
