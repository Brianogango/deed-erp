'use client'

type Mode = 'preview' | 'done'

type Props = {
  /** Current quotation ref before confirm, or former quotation ref after. */
  quotationRef: string
  /** Confirmed SO ref when mode is done; omit for preview (shows SO/…). */
  salesOrderRef?: string
  mode: Mode
  /** Extra class on the root (e.g. dialog padding). */
  className?: string
}

/**
 * Visual cue that Confirm renames one commercial record (QUO → SO).
 * Used in the confirm dialog and on the sales order form header.
 */
export function SameDocumentIdentity({
  quotationRef,
  salesOrderRef,
  mode,
  className,
}: Props) {
  const toRef = mode === 'done' && salesOrderRef ? salesOrderRef : 'SO/…'
  const fromRef = quotationRef
  const shell =
    mode === 'preview'
      ? 'rounded-md border border-[var(--sp-border)] bg-[var(--sp-grey-bg,#f5f6f8)] px-3 py-2.5'
      : ''
  return (
    <div
      className={[shell, className].filter(Boolean).join(' ')}
      role="note"
      style={mode === 'done' ? { marginTop: 6 } : undefined}
    >
      <div
        aria-label={`${fromRef} becomes ${toRef}`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 8,
          fontSize: 13,
          fontWeight: 650,
          letterSpacing: '0.01em',
          color: 'var(--sp-text)',
        }}
      >
        <span
          style={{
            fontVariantNumeric: 'tabular-nums',
            color: mode === 'done' ? 'var(--sp-text-2)' : 'var(--sp-text)',
            textDecoration: mode === 'done' ? 'line-through' : 'none',
            textDecorationThickness: 1,
          }}
        >
          {fromRef}
        </span>
        <span aria-hidden style={{ color: 'var(--sp-text-3)', fontWeight: 500 }}>
          →
        </span>
        <span
          style={{
            fontVariantNumeric: 'tabular-nums',
            color: 'var(--sp-accent, var(--primary))',
          }}
        >
          {toRef}
        </span>
      </div>
      <p
        className="m-0"
        style={{
          marginTop: 6,
          fontSize: 11.5,
          lineHeight: 1.35,
          color: 'var(--sp-text-3)',
        }}
      >
        {mode === 'preview'
          ? 'Confirm renames this same record. No second order is created.'
          : 'Same commercial document — reference renamed on confirm.'}
      </p>
    </div>
  )
}
