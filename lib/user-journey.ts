export type LinkedDocumentCta = 'create' | 'view' | 'confirm' | 'none'

export function linkedDocumentCta(opts: {
  exists?: boolean
  draft?: boolean
  terminal?: boolean
  canCreate?: boolean
  canConfirm?: boolean
}): LinkedDocumentCta {
  if (opts.terminal && !opts.exists) return 'none'
  if (opts.exists) {
    if (opts.draft && opts.canConfirm) return 'confirm'
    return 'view'
  }
  return opts.canCreate ? 'create' : 'none'
}

export function isTerminalJourneyState(status?: string | null): boolean {
  return new Set([
    'paid',
    'delivered',
    'closed',
    'cancelled',
    'returned',
    'retained',
    'rejected',
    'voided',
  ]).has(String(status ?? '').toLowerCase())
}

export function nextActionLabel(opts: {
  document: string
  cta: LinkedDocumentCta
}): string | null {
  if (opts.cta === 'create') return `Create ${opts.document}`
  if (opts.cta === 'view') return `View ${opts.document}`
  if (opts.cta === 'confirm') return `Confirm ${opts.document}`
  return null
}

export function actionableSelectionCount<T>(rows: readonly T[], isActionable: (row: T) => boolean): number {
  return rows.reduce((count, row) => count + (isActionable(row) ? 1 : 0), 0)
}

export function shouldExposeProgressionAction(opts: {
  status?: string | null
  allowedStatuses: readonly string[]
  terminalStatuses?: readonly string[]
}): boolean {
  const status = String(opts.status ?? '').toLowerCase()
  const terminal = new Set((opts.terminalStatuses ?? ['paid', 'delivered', 'closed', 'cancelled', 'returned', 'retained', 'rejected', 'voided']).map(s => String(s).toLowerCase()))
  if (terminal.has(status)) return false
  return opts.allowedStatuses.map(s => String(s).toLowerCase()).includes(status)
}
