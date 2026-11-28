'use client'

import ReactBarcode from 'react-barcode'
import { fmtKes } from '@/lib/store'
import type { ExchangeDocumentView, ExchangeMachine } from '@/lib/after-sales/exchange-document'

function Side({ kind, items }: { kind: 'returned' | 'given'; items: ExchangeMachine[] }) {
  return (
    <div className={`xsw-side xsw-side--${kind}`}>
      <div className="xsw-k">{kind === 'returned' ? 'Returned by customer' : 'Given to customer'}</div>
      {items.length ? items.map((m, i) => (
        <div key={i} className="xsw-item">
          <div className="xsw-name">{m.productName}{m.qty > 1 ? ` ×${m.qty}` : ''}</div>
          {m.specs && !m.productName.includes(m.specs) && <div className="xsw-specs">{m.specs}</div>}
          <div className="xsw-row">
            {m.serial ? (
              <div className="xsw-code">
                <ReactBarcode value={m.serial} width={1.1} height={26} displayValue={false} margin={0} background="transparent" />
                <span>{m.serial}</span>
              </div>
            ) : <span className="xsw-noserial">No serial</span>}
            <b className="xsw-amt">{fmtKes(m.amount)}</b>
          </div>
        </div>
      )) : <div className="xsw-specs">Nothing</div>}
    </div>
  )
}

/** The machines an exchange swapped: handed back on the left, given on the right. */
export function ExchangeSwapCard({ view, title = 'What was exchanged', aside }: { view: ExchangeDocumentView; title?: string; aside?: React.ReactNode }) {
  return (
    <section className="xsw" aria-label={title}>
      <div className="xsw-head">
        <h2>{title}</h2>
        {aside && <span className="xsw-aside">{aside}</span>}
      </div>
      <div className="xsw-grid">
        <Side kind="returned" items={view.returned} />
        <div className="xsw-arrow" aria-hidden="true">→</div>
        <Side kind="given" items={view.given} />
      </div>
    </section>
  )
}
