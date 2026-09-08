import { describe, it, expect } from 'vitest'
import {
  applyRepairHandover,
  canCloseRepairAfterHandover,
  canCollectWithoutReleaseCheckpoint,
  pickRepairPrimaryAction,
  shouldDefaultCloseAfterHandover,
} from '@/lib/repair-handover'

describe('canCollectWithoutReleaseCheckpoint', () => {
  it('skips the serial checkpoint for no-charge jobs', () => {
    expect(canCollectWithoutReleaseCheckpoint({ noCharge: true, serialNumber: 'SN-1' })).toBe(true)
  })

  it('skips the serial checkpoint when serial is empty', () => {
    expect(canCollectWithoutReleaseCheckpoint({ noCharge: false, serialNumber: '' })).toBe(true)
    expect(canCollectWithoutReleaseCheckpoint({ noCharge: false, serialNumber: '   ' })).toBe(true)
    expect(canCollectWithoutReleaseCheckpoint({ noCharge: false })).toBe(true)
  })

  it('keeps the checkpoint for billed jobs with a serial', () => {
    expect(canCollectWithoutReleaseCheckpoint({ noCharge: false, serialNumber: 'SN-1' })).toBe(false)
  })
})

describe('pickRepairPrimaryAction — ready for pickup', () => {
  const readyBase = {
    canPrepareRelease: true,
    canMarkCollected: true,
  }

  it('shows Mark collected first on no-charge ready jobs (Rueben-style warranty)', () => {
    expect(pickRepairPrimaryAction({
      ...readyBase,
      noCharge: true,
      serialNumber: '',
    })).toBe('collect')
  })

  it('shows Mark collected first when there is no serial, even if billed', () => {
    expect(pickRepairPrimaryAction({
      ...readyBase,
      noCharge: false,
      serialNumber: '',
    })).toBe('collect')
  })

  it('keeps Prepare release first for billed jobs with a serial', () => {
    expect(pickRepairPrimaryAction({
      ...readyBase,
      noCharge: false,
      serialNumber: 'SN-5410',
    })).toBe('prepare_release')
  })

  it('still prefers invoice over collect on billed ready jobs', () => {
    expect(pickRepairPrimaryAction({
      ...readyBase,
      canInvoice: true,
      noCharge: false,
      serialNumber: '',
    })).toBe('invoice')
  })

  it('shows Close job after collection when handover did not auto-close', () => {
    expect(pickRepairPrimaryAction({
      canPrepareRelease: false,
      canMarkCollected: false,
      canCloseJob: true,
      noCharge: true,
    })).toBe('close')
  })

  it('does not offer collect while an unverified release checkpoint is open', () => {
    expect(pickRepairPrimaryAction({
      canPrepareRelease: false,
      canMarkCollected: true,
      noCharge: true,
      serialNumber: '',
      repairOrcStatus: 'pending',
    })).toBeNull()
  })

  it('offers collect once the release checkpoint is verified', () => {
    expect(pickRepairPrimaryAction({
      canPrepareRelease: false,
      canMarkCollected: true,
      noCharge: false,
      serialNumber: 'SN-5410',
      repairOrcStatus: 'verified',
    })).toBe('collect')
  })
})

describe('applyRepairHandover', () => {
  const noChargeReady = { billingExempt: true, status: 'ready' as const }
  const billedReady = { status: 'ready' as const, invoiceId: undefined }

  it('defaults Close after handover on for no-charge jobs', () => {
    expect(shouldDefaultCloseAfterHandover(noChargeReady)).toBe(true)
    expect(shouldDefaultCloseAfterHandover(billedReady)).toBe(false)
    expect(canCloseRepairAfterHandover(noChargeReady)).toBe(true)
    expect(canCloseRepairAfterHandover(billedReady)).toBe(false)
    expect(canCloseRepairAfterHandover({ invoiceId: 'INV-1' })).toBe(true)
  })

  it('moves ready → closed in one write when closeAfter is set on a no-charge job', () => {
    const next = applyRepairHandover(noChargeReady, {
      recipientName: 'RUEBEN NKUKUU',
      recipientPhone: '0700000000',
      closeAfter: true,
      now: '2026-08-26',
    })
    expect(next.status).toBe('closed')
    expect(next.closedDate).toBe('2026-08-26')
    expect(next.deliveryActualDate).toBe('2026-08-26')
    expect(next.deliveryRecipient).toBe('RUEBEN NKUKUU')
  })

  it('stays delivered when closeAfter is off', () => {
    const next = applyRepairHandover(noChargeReady, {
      recipientName: 'RUEBEN NKUKUU',
      closeAfter: false,
      now: '2026-08-26',
    })
    expect(next.status).toBe('delivered')
    expect(next.closedDate).toBeUndefined()
  })

  it('does not close a billed job that still needs an invoice', () => {
    const next = applyRepairHandover(billedReady, {
      recipientName: 'Client',
      closeAfter: true,
      now: '2026-08-26',
    })
    expect(next.status).toBe('delivered')
    expect(next.closedDate).toBeUndefined()
  })

  it('closes a billed job that already has an invoice', () => {
    const next = applyRepairHandover({ invoiceId: 'INV-9' }, {
      recipientName: 'Client',
      closeAfter: true,
      now: '2026-08-26',
    })
    expect(next.status).toBe('closed')
    expect(next.closedDate).toBe('2026-08-26')
  })

  it('closes a billed job linked by linkedInvoiceId', () => {
    expect(canCloseRepairAfterHandover({ linkedInvoiceId: 'INV-9' })).toBe(true)
    const next = applyRepairHandover({ linkedInvoiceId: 'INV-9' }, {
      recipientName: 'Client',
      closeAfter: true,
      now: '2026-08-26',
    })
    expect(next.status).toBe('closed')
  })

  it('records representative details only on the rep path', () => {
    const next = applyRepairHandover(noChargeReady, {
      recipientName: 'Driver Joe',
      isRep: true,
      repRelationship: 'Driver',
      repIdNumber: '123',
      now: '2026-08-26',
    })
    expect(next.deliveryRecipientIsRep).toBe(true)
    expect(next.deliveryRecipientRelationship).toBe('Driver')
    expect(next.deliveryRecipientIdNumber).toBe('123')

    const client = applyRepairHandover(noChargeReady, {
      recipientName: 'RUEBEN NKUKUU',
      isRep: false,
      repRelationship: 'Driver',
      now: '2026-08-26',
    })
    expect(client.deliveryRecipientRelationship).toBeUndefined()
  })
})
