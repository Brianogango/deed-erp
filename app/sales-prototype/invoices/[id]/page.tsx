'use client'

import Link from 'next/link'
import { useState } from 'react'
import { DEMO_INVOICE, formatKes } from '@/components/sales-prototype/demo-data'
import {
  ProtoAction,
  PrototypeShell,
  StatusPill,
  Tabs,
  TotalsPanel,
} from '@/components/sales-prototype/shell'

export default function InvoicePaymentPrototype() {
  const inv = DEMO_INVOICE
  const [tab, setTab] = useState('Invoice Lines')

  return (
    <PrototypeShell title="Invoice and payment">
      <div className="sales-proto-page-header">
        <div>
          <div className="sp-ref-row">
            <h1>{inv.ref}</h1>
            <StatusPill label={inv.status.label} tone={inv.status.tone} />
            <StatusPill label="Partially paid" tone="amber" />
          </div>
          <div className="sub">
            SO{' '}
            <Link className="sp-linkish" href="/sales-prototype/orders/so-001">
              {inv.salesOrder}
            </Link>{' '}
            · Delivery {inv.delivery}
          </div>
        </div>
        <div className="sales-proto-actions">
          <ProtoAction>Print</ProtoAction>
          <ProtoAction>Send by email</ProtoAction>
          <ProtoAction primary>Record payment</ProtoAction>
        </div>
      </div>

      <div className="sp-panel sp-panel-pad">
        <div className="sp-grid-2">
          <div className="sp-field">
            <label>Customer</label>
            <div>{inv.customer.name}</div>
          </div>
          <div className="sp-field">
            <label>Contact</label>
            <div>{inv.customer.contact}</div>
          </div>
          <div className="sp-field">
            <label>Invoice date</label>
            <div>{inv.invoiceDate}</div>
          </div>
          <div className="sp-field">
            <label>Due date</label>
            <div>{inv.dueDate}</div>
          </div>
          <div className="sp-field">
            <label>Payment terms</label>
            <div>{inv.paymentTerms}</div>
          </div>
          <div className="sp-field">
            <label>Currency</label>
            <div>{inv.currency}</div>
          </div>
        </div>
      </div>

      <div className="sp-invoice-layout">
        <div className="sp-panel">
          <Tabs
            tabs={['Invoice Lines', 'Payments', 'Other Information', 'Notes', 'Attachments', 'History', 'Activities']}
            active={tab}
            onChange={setTab}
          />
          {tab === 'Invoice Lines' && (
            <div className="sp-table-wrap">
              <table className="sp-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th className="num">Qty</th>
                    <th>Unit</th>
                    <th className="num">Unit price</th>
                    <th>Tax</th>
                    <th className="num">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {inv.lines.map(line => (
                    <tr key={line.product}>
                      <td>{line.product}</td>
                      <td className="num">{line.invoicing}</td>
                      <td>{line.uom}</td>
                      <td className="num">{formatKes(line.unitPrice)}</td>
                      <td>{line.taxRate}%</td>
                      <td className="num">{formatKes(line.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {tab === 'Payments' && (
            <div className="sp-table-wrap">
              <table className="sp-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Reference</th>
                    <th>Method</th>
                    <th>Journal</th>
                    <th className="num">Amount</th>
                    <th>Status</th>
                    <th>Received by</th>
                  </tr>
                </thead>
                <tbody>
                  {inv.payments.map(p => (
                    <tr key={p.ref}>
                      <td>{p.date}</td>
                      <td>{p.ref}</td>
                      <td>{p.method}</td>
                      <td>{p.journal}</td>
                      <td className="num">{formatKes(p.amount)}</td>
                      <td>
                        <StatusPill label={p.status.label} tone={p.status.tone} />
                      </td>
                      <td>{p.receivedBy}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!['Invoice Lines', 'Payments'].includes(tab) && (
            <div className="sp-panel-pad" style={{ color: 'var(--sp-text-3)' }}>
              {tab} (prototype placeholder).
            </div>
          )}
        </div>
        <div className="sp-panel sp-panel-pad" style={{ alignSelf: 'start' }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 12 }}>Summary</h3>
          <TotalsPanel
            rows={[
              { label: 'Untaxed amount', value: formatKes(inv.untaxed) },
              { label: 'VAT', value: formatKes(inv.tax) },
              { label: 'Total', value: formatKes(inv.total), grand: true },
              { label: 'Paid', value: formatKes(inv.paid) },
              { label: 'Balance', value: formatKes(inv.balance) },
            ]}
          />
        </div>
      </div>
    </PrototypeShell>
  )
}
