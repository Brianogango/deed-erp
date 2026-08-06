'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import {
  DEMO_CUSTOMER,
  DEMO_QUOTE_LINES,
  DEMO_QUOTATIONS,
  DEMO_SALESPERSON,
  formatKes,
  lineAmount,
  quoteTotals,
} from '@/components/sales-prototype/demo-data'
import {
  ProtoAction,
  PrototypeShell,
  StatusPill,
  Tabs,
  TotalsPanel,
  useProtoToast,
} from '@/components/sales-prototype/shell'

export default function QuotationDetailPrototype({ params }: { params: { id: string } }) {
  const quote = DEMO_QUOTATIONS.find(q => q.id === params.id) ?? DEMO_QUOTATIONS[0]
  const [tab, setTab] = useState('Order Lines')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const totals = useMemo(() => quoteTotals(), [])
  const { show, toast } = useProtoToast()

  return (
    <PrototypeShell title="Quotation detail">
      <div className="sales-proto-page-header">
        <div>
          <div className="sp-ref-row">
            <h1>{quote.ref}</h1>
            <StatusPill label={quote.status.label} tone={quote.status.tone} />
          </div>
          <div className="sub">
            Source customer {DEMO_CUSTOMER.name} · Salesperson {DEMO_SALESPERSON.name}
          </div>
        </div>
        <div className="sales-proto-actions">
          <ProtoAction>Edit</ProtoAction>
          <ProtoAction primary>Send to customer</ProtoAction>
          <ProtoAction>More</ProtoAction>
          <button type="button" className="sp-btn sp-btn-success" onClick={() => setConfirmOpen(true)}>
            Confirm quotation
          </button>
        </div>
      </div>

      {quote.status.label === 'Accepted' && (
        <div className="sp-banner-ok" role="status">
          <span aria-hidden>✓</span>
          <div>
            <strong>Customer accepted this quotation.</strong>
            <div>Accepted by {DEMO_CUSTOMER.contact} on 2026-08-05 · ready to confirm into a sales order.</div>
          </div>
        </div>
      )}

      <div className="sp-banner-warn" role="status">
        <span aria-hidden>!</span>
        <div>
          Stock warning: Dell Latitude 5440 has 0 free units at Warehouse after other reservations.
        </div>
      </div>

      <div className="sp-panel sp-panel-pad">
        <div className="sp-grid-2">
          <div>
            <div className="sp-field" style={{ marginBottom: 8 }}>
              <label>Customer</label>
              <div>{DEMO_CUSTOMER.name}</div>
            </div>
            <div className="sp-field" style={{ marginBottom: 8 }}>
              <label>Contact</label>
              <div>{DEMO_CUSTOMER.contact}</div>
            </div>
            <div className="sp-field" style={{ marginBottom: 8 }}>
              <label>Email</label>
              <div>{DEMO_CUSTOMER.email}</div>
            </div>
            <div className="sp-field">
              <label>Phone</label>
              <div>{DEMO_CUSTOMER.phone}</div>
            </div>
          </div>
          <div>
            <div className="sp-field" style={{ marginBottom: 8 }}>
              <label>Quote date</label>
              <div>{quote.date}</div>
            </div>
            <div className="sp-field" style={{ marginBottom: 8 }}>
              <label>Valid until</label>
              <div>{quote.validUntil}</div>
            </div>
            <div className="sp-field" style={{ marginBottom: 8 }}>
              <label>Salesperson</label>
              <div>{quote.salesperson}</div>
            </div>
            <div className="sp-field" style={{ marginBottom: 8 }}>
              <label>Payment terms</label>
              <div>Net 30</div>
            </div>
            <div className="sp-field">
              <label>Currency</label>
              <div>{quote.currency}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="sp-panel" style={{ marginTop: 10 }}>
        <Tabs
          tabs={['Order Lines', 'Terms and Conditions', 'Notes', 'Activities', 'History']}
          active={tab}
          onChange={setTab}
        />
        {tab === 'Order Lines' && (
          <>
            <div className="sp-table-wrap">
              <table className="sp-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Description</th>
                    <th className="num">Qty</th>
                    <th>Unit</th>
                    <th className="num">Unit price</th>
                    <th>Tax</th>
                    <th className="num">Amount</th>
                    <th className="num">Available</th>
                  </tr>
                </thead>
                <tbody>
                  {DEMO_QUOTE_LINES.map(line => (
                    <tr key={line.id}>
                      <td>{line.product}</td>
                      <td>{line.description}</td>
                      <td className="num">{line.qty}</td>
                      <td>{line.uom}</td>
                      <td className="num">{formatKes(line.unitPrice)}</td>
                      <td>{line.taxRate}%</td>
                      <td className="num">{formatKes(lineAmount(line))}</td>
                      <td className="num">{line.available}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <TotalsPanel
              rows={[
                { label: 'Untaxed amount', value: formatKes(totals.untaxed) },
                { label: 'Discount', value: formatKes(totals.discount) },
                { label: 'VAT', value: formatKes(totals.tax) },
                { label: 'Total', value: formatKes(totals.total), grand: true },
                { label: 'Gross margin %', value: `${totals.marginPct}%` },
              ]}
            />
          </>
        )}
        {tab === 'History' && (
          <div className="sp-panel-pad">
            <table className="sp-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>User</th>
                  <th>Action</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>2026-08-05 11:04</td>
                  <td>Portal · Amina</td>
                  <td>Customer acceptance</td>
                  <td>Accepted via customer portal</td>
                </tr>
                <tr>
                  <td>2026-08-04 16:20</td>
                  <td>Brian Oketch</td>
                  <td>Quotation sent</td>
                  <td>Email to {DEMO_CUSTOMER.email}</td>
                </tr>
                <tr>
                  <td>2026-08-04 15:48</td>
                  <td>Brian Oketch</td>
                  <td>Draft saved</td>
                  <td>3 lines · {formatKes(totals.total)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
        {!['Order Lines', 'History'].includes(tab) && (
          <div className="sp-panel-pad" style={{ color: 'var(--sp-text-3)' }}>
            {tab} (prototype placeholder).
          </div>
        )}
      </div>

      {confirmOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-title"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15,23,42,0.45)',
            display: 'grid',
            placeItems: 'center',
            zIndex: 40,
            padding: 16,
          }}
        >
          <div className="sp-panel" style={{ width: 'min(440px, 100%)' }}>
            <div className="sp-panel-pad">
              <h2 id="confirm-title" style={{ margin: '0 0 8px', fontSize: 16 }}>
                Confirm quotation
              </h2>
              <p style={{ margin: '0 0 12px', fontSize: 12.5, color: 'var(--sp-text-3)' }}>
                Creates linked sales order {quote.ref.replace('SQ', 'SO')}, locks this quotation version,
                and records an audit event. Prototype only — no production write.
              </p>
              <ul style={{ margin: '0 0 14px', paddingLeft: 18, fontSize: 12.5, color: 'var(--sp-text-2)' }}>
                <li>Customer and lines validated</li>
                <li>Expiry valid until {quote.validUntil}</li>
                <li>Stock shortage on Dell Latitude 5440</li>
                <li>Expected delivery 2026-08-08</li>
              </ul>
              <div className="sales-proto-actions">
                <button type="button" className="sp-btn" onClick={() => setConfirmOpen(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="sp-btn"
                  onClick={() => {
                    setConfirmOpen(false)
                    show('Prototype: confirm without reservation (no production write).')
                  }}
                >
                  Confirm without reservation
                </button>
                <Link
                  href="/sales-prototype/orders/so-001"
                  className="sp-btn sp-btn-primary"
                  onClick={() => setConfirmOpen(false)}
                >
                  Confirm and reserve stock
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}
      {toast}
    </PrototypeShell>
  )
}
