import { describe, expect, it } from 'vitest'
import {
  actionableSelectionCount,
  isTerminalJourneyState,
  linkedDocumentCta,
  nextActionLabel,
  shouldExposeProgressionAction,
} from '@/lib/user-journey'

describe('linkedDocumentCta', () => {
  it('creates only when the linked document does not exist and creation is allowed', () => {
    expect(linkedDocumentCta({ exists: false, canCreate: true })).toBe('create')
    expect(nextActionLabel({ document: 'Invoice', cta: 'create' })).toBe('Create Invoice')
  })

  it('switches Create to View as soon as the linked document exists', () => {
    expect(linkedDocumentCta({ exists: true, canCreate: true })).toBe('view')
    expect(nextActionLabel({ document: 'Invoice', cta: 'view' })).toBe('View Invoice')
  })

  it('uses Confirm for an existing draft when the role may confirm it', () => {
    expect(linkedDocumentCta({ exists: true, draft: true, canConfirm: true })).toBe('confirm')
    expect(nextActionLabel({ document: 'Invoice', cta: 'confirm' })).toBe('Confirm Invoice')
  })

  it('does not expose downstream creation from a terminal record', () => {
    expect(linkedDocumentCta({ terminal: true, exists: false, canCreate: true })).toBe('none')
  })

  it('still permits opening an existing linked document from a terminal record', () => {
    expect(linkedDocumentCta({ terminal: true, exists: true, canCreate: true })).toBe('view')
  })
})

describe('isTerminalJourneyState', () => {
  it('recognizes common terminal states', () => {
    for (const status of ['paid', 'delivered', 'closed', 'cancelled', 'returned', 'retained', 'rejected', 'voided']) {
      expect(isTerminalJourneyState(status)).toBe(true)
    }
  })

  it('keeps active states actionable', () => {
    for (const status of ['draft', 'sent', 'confirmed', 'ready', 'invoiced', 'partial']) {
      expect(isTerminalJourneyState(status)).toBe(false)
    }
  })
})

describe('journey action guards', () => {
  it('counts only actionable rows for bulk actions', () => {
    const rows = [{ status: 'draft' }, { status: 'received' }, { status: 'sent' }]
    expect(actionableSelectionCount(rows, row => ['draft', 'sent'].includes(row.status))).toBe(2)
  })

  it('never exposes progression from terminal states', () => {
    expect(shouldExposeProgressionAction({ status: 'closed', allowedStatuses: ['ready', 'closed'] })).toBe(false)
    expect(shouldExposeProgressionAction({ status: 'ready', allowedStatuses: ['ready', 'invoiced'] })).toBe(true)
    expect(shouldExposeProgressionAction({ status: 'draft', allowedStatuses: ['ready', 'invoiced'] })).toBe(false)
  })
})
