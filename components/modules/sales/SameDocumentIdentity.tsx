'use client'

type Mode = 'preview' | 'done'

type Props = {
  quotationRef: string
  salesOrderRef?: string
  mode: Mode
  className?: string
}

export function SameDocumentIdentity({
  quotationRef,
  salesOrderRef,
  mode,
  className,
}: Props) {
  const toRef = mode === 'done' && salesOrderRef ? salesOrderRef : 'SO/…'
  return (
    <div
      className={['sales-document-transition', `sales-document-transition--${mode}`, className].filter(Boolean).join(' ')}
      role="note"
    >
      <div className="sales-document-transition__refs" aria-label={`${quotationRef} becomes ${toRef}`}>
        <span className="sales-document-transition__from">{quotationRef}</span>
        <span className="sales-document-transition__arrow" aria-hidden>→</span>
        <span className="sales-document-transition__to">{toRef}</span>
      </div>
      <p>
        {mode === 'preview'
          ? 'Same record; the reference changes on confirmation.'
          : 'Same commercial document, renamed on confirmation.'}
      </p>
    </div>
  )
}
