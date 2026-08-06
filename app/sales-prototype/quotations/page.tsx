'use client'

import Link from 'next/link'
import { DEMO_QUOTATIONS, formatKes } from '@/components/sales-prototype/demo-data'
import { ProtoAction, PrototypeShell, StatusPill } from '@/components/sales-prototype/shell'

export default function QuotationsListPrototype() {
  return (
    <PrototypeShell title="Quotations">
      <div className="sales-proto-page-header">
        <div>
          <h1>Quotations</h1>
          <div className="sub">Draft → send → accept → convert to sales order</div>
        </div>
        <div className="sales-proto-actions">
          <ProtoAction ghost>Import</ProtoAction>
          <Link href="/sales-prototype/quotations/new" className="sp-btn sp-btn-primary">
            New quotation
          </Link>
        </div>
      </div>

      <div className="sp-panel">
        <div className="sp-tabs" role="tablist">
          <button type="button" className="sp-tab" data-active="true" role="tab" aria-selected>
            Quotations
          </button>
          <button type="button" className="sp-tab" role="tab" aria-selected={false}>
            Orders
          </button>
        </div>
        <div className="sp-table-wrap">
          <table className="sp-table">
            <thead>
              <tr>
                <th>Reference</th>
                <th>Customer</th>
                <th>Contact</th>
                <th>Date</th>
                <th>Valid until</th>
                <th>Salesperson</th>
                <th className="num">Total</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {DEMO_QUOTATIONS.map(q => (
                <tr key={q.id}>
                  <td>
                    <Link className="sp-linkish" href={`/sales-prototype/quotations/${q.id}`}>
                      {q.ref}
                    </Link>
                  </td>
                  <td>{q.customer}</td>
                  <td>{q.contact}</td>
                  <td>{q.date}</td>
                  <td>{q.validUntil}</td>
                  <td>{q.salesperson}</td>
                  <td className="num">{formatKes(q.total)}</td>
                  <td>
                    <StatusPill label={q.status.label} tone={q.status.tone} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </PrototypeShell>
  )
}
