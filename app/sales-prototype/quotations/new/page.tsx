'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import {
  DEMO_CUSTOMER,
  DEMO_QUOTE_LINES,
  DEMO_SALESPERSON,
  formatKes,
  lineAmount,
  quoteTotals,
} from '@/components/sales-prototype/demo-data'
import { ProtoAction, PrototypeShell, Tabs, TotalsPanel } from '@/components/sales-prototype/shell'

export default function CreateQuotationPrototype() {
  const [tab, setTab] = useState('Order Lines')
  const totals = useMemo(() => quoteTotals(), [])

  return (
    <PrototypeShell title="Create quotation">
      <div className="sales-proto-page-header">
        <div>
          <Link href="/sales-prototype/quotations" className="sp-btn sp-btn-ghost" style={{ paddingLeft: 0 }}>
            ← Back
          </Link>
          <h1>Create quotation</h1>
          <div className="sub">Customer · lines · terms · send</div>
        </div>
        <div className="sales-proto-actions">
          <ProtoAction>Discard</ProtoAction>
          <ProtoAction>Save as draft</ProtoAction>
          <ProtoAction primary>Submit</ProtoAction>
        </div>
      </div>

      <div className="sp-panel sp-panel-pad">
        <div className="sp-grid-2">
          <div>
            <div className="sp-field" style={{ marginBottom: 10 }}>
              <label htmlFor="c-customer">Customer</label>
              <input id="c-customer" defaultValue={DEMO_CUSTOMER.name} readOnly />
            </div>
            <div className="sp-field" style={{ marginBottom: 10 }}>
              <label htmlFor="c-contact">Contact</label>
              <input id="c-contact" defaultValue={DEMO_CUSTOMER.contact} readOnly />
            </div>
            <div className="sp-field" style={{ marginBottom: 10 }}>
              <label htmlFor="c-email">Email</label>
              <input id="c-email" defaultValue={DEMO_CUSTOMER.email} readOnly />
            </div>
            <div className="sp-field">
              <label htmlFor="c-phone">Phone</label>
              <input id="c-phone" defaultValue={DEMO_CUSTOMER.phone} readOnly />
            </div>
          </div>
          <div>
            <div className="sp-field" style={{ marginBottom: 10 }}>
              <label htmlFor="c-date">Quotation date</label>
              <input id="c-date" type="date" defaultValue="2026-08-06" readOnly />
            </div>
            <div className="sp-field" style={{ marginBottom: 10 }}>
              <label htmlFor="c-valid">Valid until</label>
              <input id="c-valid" type="date" defaultValue="2026-08-20" readOnly />
            </div>
            <div className="sp-field" style={{ marginBottom: 10 }}>
              <label htmlFor="c-plist">Price list</label>
              <select id="c-plist" defaultValue="standard" disabled>
                <option value="standard">Public · KES</option>
              </select>
            </div>
            <div className="sp-field" style={{ marginBottom: 10 }}>
              <label htmlFor="c-terms">Payment terms</label>
              <input id="c-terms" defaultValue="Net 30" readOnly />
            </div>
            <div className="sp-field">
              <label htmlFor="c-sp">Salesperson</label>
              <input id="c-sp" defaultValue={DEMO_SALESPERSON.name} readOnly />
            </div>
          </div>
        </div>
      </div>

      <div className="sp-panel" style={{ marginTop: 10 }}>
        <Tabs
          tabs={['Order Lines', 'Optional Products', 'Notes', 'Terms and Conditions', 'Attachments']}
          active={tab}
          onChange={setTab}
        />
        {tab === 'Order Lines' && (
          <>
            <div className="sp-table-wrap">
              <table className="sp-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Product</th>
                    <th>Description</th>
                    <th className="num">Qty</th>
                    <th>Unit</th>
                    <th className="num">Unit price</th>
                    <th>Taxes</th>
                    <th className="num">Amount</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {DEMO_QUOTE_LINES.map((line, idx) => (
                    <tr key={line.id}>
                      <td>{idx + 1}</td>
                      <td>
                        {line.product}
                        {line.serialTracked ? (
                          <div style={{ fontSize: 10, color: 'var(--sp-text-3)' }}>Serial</div>
                        ) : null}
                      </td>
                      <td>{line.description}</td>
                      <td className="num">{line.qty}</td>
                      <td>{line.uom}</td>
                      <td className="num">{formatKes(line.unitPrice)}</td>
                      <td>{line.taxRate}%</td>
                      <td className="num">{formatKes(lineAmount(line))}</td>
                      <td>
                        <ProtoAction ghost>⋯</ProtoAction>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="sp-panel-pad" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <ProtoAction>Add a line</ProtoAction>
              <ProtoAction>Add a section</ProtoAction>
              <ProtoAction>Add a note</ProtoAction>
            </div>
            <TotalsPanel
              sticky
              rows={[
                { label: 'Untaxed amount', value: formatKes(totals.untaxed) },
                { label: 'Taxes', value: formatKes(totals.tax) },
                { label: 'Total', value: formatKes(totals.total), grand: true },
                { label: 'Currency', value: totals.currency },
              ]}
            />
          </>
        )}
        {tab !== 'Order Lines' && (
          <div className="sp-panel-pad" style={{ color: 'var(--sp-text-3)' }}>
            {tab} content (prototype placeholder — demo data only).
          </div>
        )}
      </div>
    </PrototypeShell>
  )
}
