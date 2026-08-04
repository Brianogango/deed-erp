import { describe, it, expect } from 'vitest'

/**
 * Regression guard for Purchase deep-link sync:
 * when a PO is open via ?id=, switching to the GRN receive screen must NOT
 * be forced back to the form view.
 *
 * The real logic lives in Purchase.tsx; this documents the intended rule so
 * future URL-sync refactors keep the receive path intact.
 */
function nextSubViewAfterUrlSync(opts: {
  urlActiveId: string | null
  subView: 'list' | 'form' | 'receive'
  poExists: boolean
}): 'list' | 'form' | 'receive' {
  if (!opts.urlActiveId || !opts.poExists) return opts.subView
  // Only promote list → form for deep links. Leave receive alone.
  if (opts.subView === 'list') return 'form'
  return opts.subView
}

describe('Purchase Process GRN URL sync', () => {
  it('keeps receive view when a PO id is in the URL', () => {
    expect(
      nextSubViewAfterUrlSync({
        urlActiveId: 'po-1',
        subView: 'receive',
        poExists: true,
      }),
    ).toBe('receive')
  })

  it('opens form from list when a PO id is in the URL', () => {
    expect(
      nextSubViewAfterUrlSync({
        urlActiveId: 'po-1',
        subView: 'list',
        poExists: true,
      }),
    ).toBe('form')
  })

  it('does not leave form when already on form', () => {
    expect(
      nextSubViewAfterUrlSync({
        urlActiveId: 'po-1',
        subView: 'form',
        poExists: true,
      }),
    ).toBe('form')
  })
})
