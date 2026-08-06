'use client'

import Link from 'next/link'
import { useState } from 'react'
import { DEMO_CUSTOMER, DEMO_INVOICE, DEMO_SO, formatKes } from '@/components/sales-prototype/demo-data'
import { ProtoAction, PrototypeShell, Tabs } from '@/components/sales-prototype/shell'

export default function CreateInvoicePrototype() {
  const [tab, setTab] = useState('Invoice Lines')
  const [mode, setMode] = useState('delivered')

  return (
    <PrototypeShell title="Create invoice">
      <div className="sales-proto-page-header">
        <div>
          <h1>Create invoice</h1>
          <div className="sub">
            Source{' '}
            <Link className="sp-linkish" href="/sales-prototype/orders/so-001">
              {DEMO_SO.ref}
            </Link>{' '}
            · Delivery DN/2026/0044
          </div>
        </div>
        <div className="sales-proto-actions">
          <ProtoAction>Cancel</ProtoAction>
          <ProtoAction>Save draft</ProtoAction>
          <ProtoAction primary>Create invoice</ProtoAction>
        </div>
      </div>

      <div className="sp-panel sp-panel-pad">
        <div className="sp-grid-2">
          <div className="sp-field">
            <label>Customer</label>
            <div>{DEMO_CUSTOMER.name}</div>
          </div>
          <div className="sp-field">
            <label>Invoice date</label>
            <input type="date" defaultValue="2026-08-08" readOnly />
          </div>
          <div className="sp-field">
            <label>Due date</label>
            <input type="date" defaultValue="2026-09-07" readOnly />
          </div>
          <div className="sp-field">
            <label>Payment terms</label>
            <div>Net 30</div>
          </div>
          <div className="sp-field" style={{ gridColumn: '1 / -1' }}>
            <label>Billing address</label>
            <div style={{ whiteSpace: 'pre-line' }}>{DEMO_CUSTOMER.billingAddress}</div>
          </div>
        </div>
        <fieldset style={{ marginTop: 12, border: '1px solid var(--sp-border)', borderRadius: 6, padding: 10 }}>
          <legend style={{ fontSize: 11, fontWeight: 650, color: 'var(--sp-text-3)', padding: '0 4px' }}>
            Invoice options
          </legend>
          {[
            ['ordered', 'Invoice ordered quantities'],
            ['delivered', 'Invoice delivered quantities'],
            ['selected', 'Invoice selected lines'],
            ['deposit', 'Create deposit invoice'],
            ['balance', 'Create balance invoice'],
          ].map(([value, label]) => (
            <label key={value} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, marginBottom: 4 }}>
              <input
                type="radio"
                name="inv-mode"
                checked={mode === value}
                onChange={() => setMode(value)}
              />
              {label}
            </label>
          ))}
        </fieldset>
      </div>

      <div className="sp-panel" style={{ marginTop: 10 }}>
        <Tabs tabs={['Invoice Lines', 'Notes']} active={tab} onChange={setTab} />
        {tab === 'Invoice Lines' && (
          <>
            <div className="sp-table-wrap">
              <table className="sp-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th className="num">Ordered</th>
                    <th className="num">Delivered</th>
                    <th className="num">Prev. invoiced</th>
                    <th className="num">Invoicing now</th>
                    <th className="num">Remaining</th>
                    <th>Unit</th>
                    <th className="num">Unit price</th>
                    <th>Tax</th>
                    <th className="num">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {DEMO_INVOICE.lines.map(line => (
                    <tr key={line.product}>
                      <td>{line.product}</td>
                      <td className="num">{line.ordered}</td>
                      <td className="num">{line.delivered}</td>
                      <td className="num">{line.previouslyInvoiced}</td>
                      <td className="num">{line.invoicing}</td>
                      <td className="num">{line.remaining}</td>
                      <td>{line.uom}</td>
                      <td className="num">{formatKes(line.unitPrice)}</td>
                      <td>{line.taxRate}%</td>
                      <td className="num">{formatKes(line.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="sp-totals">
              <div className="sp-totals-row">
                <span>Untaxed amount</span>
                <span>{formatKes(DEMO_INVOICE.untaxed)}</span>
              </div>
              <div className="sp-totals-row">
                <span>VAT</span>
                <span>{formatKes(DEMO_INVOICE.tax)}</span>
              </div>
              <div className="sp-totals-row grand">
                <span>Total</span>
                <span>{formatKes(DEMO_INVOICE.total)}</span>
              </div>
              <div className="sp-totals-row">
                <span>Previously invoiced</span>
                <span>{formatKes(0)}</span>
              </div>
              <div className="sp-totals-row">
                <span>Balance to invoice</span>
                <span>{formatKes(DEMO_INVOICE.total)}</span>
              </div>
            </div>
          </>
        )}
        {tab === 'Notes' && (
          <div className="sp-panel-pad" style={{ color: 'var(--sp-text-3)' }}>
            Customer notes / internal notes (prototype).
          </div>
        )}
      </div>
    </PrototypeShell>
  )
}
