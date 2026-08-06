'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { DEMO_SO, formatKes, quoteTotals } from '@/components/sales-prototype/demo-data'
import {
  ProtoAction,
  PrototypeShell,
  StatusPill,
  Tabs,
  TotalsPanel,
  WorkflowBar,
} from '@/components/sales-prototype/shell'

export default function SalesOrderDetailPrototype() {
  const [tab, setTab] = useState('Order Lines')
  const totals = useMemo(() => quoteTotals(), [])
  const so = DEMO_SO

  return (
    <PrototypeShell title="Sales order">
      <div className="sales-proto-page-header">
        <div>
          <div className="sp-ref-row">
            <h1>{so.ref}</h1>
            <StatusPill label={so.status.label} tone={so.status.tone} />
          </div>
          <div className="sub">
            Source quotation{' '}
            <Link className="sp-linkish" href="/sales-prototype/quotations/quo-001">
              {so.sourceQuote}
            </Link>
          </div>
        </div>
        <div className="sales-proto-actions">
          <ProtoAction>Print</ProtoAction>
          <ProtoAction>Send by email</ProtoAction>
          <ProtoAction>More</ProtoAction>
          <Link href="/sales-prototype/deliveries/dn-001" className="sp-btn sp-btn-primary">
            Create delivery
          </Link>
          <Link href="/sales-prototype/invoices/new" className="sp-btn">
            Create invoice
          </Link>
        </div>
      </div>

      <WorkflowBar steps={so.workflow} />

      <div className="sp-panel sp-panel-pad">
        <div className="sp-grid-2">
          <div>
            <div className="sp-field" style={{ marginBottom: 8 }}>
              <label>Customer</label>
              <div>{so.customer.name}</div>
            </div>
            <div className="sp-field" style={{ marginBottom: 8 }}>
              <label>Contact</label>
              <div>{so.customer.contact}</div>
            </div>
            <div className="sp-field" style={{ marginBottom: 8 }}>
              <label>Order date</label>
              <div>{so.orderDate}</div>
            </div>
            <div className="sp-field">
              <label>Expected delivery</label>
              <div>{so.expectedDelivery}</div>
            </div>
          </div>
          <div>
            <div className="sp-field" style={{ marginBottom: 8 }}>
              <label>Salesperson</label>
              <div>{so.salesperson}</div>
            </div>
            <div className="sp-field" style={{ marginBottom: 8 }}>
              <label>Payment terms</label>
              <div>{so.paymentTerms}</div>
            </div>
            <div className="sp-field" style={{ marginBottom: 8 }}>
              <label>Order total</label>
              <div>{formatKes(totals.total)}</div>
            </div>
            <div className="sp-field" style={{ marginBottom: 8 }}>
              <label>Amount paid / balance</label>
              <div>
                {formatKes(so.paid)} / {formatKes(totals.total - so.paid)}
              </div>
            </div>
            <div className="sp-field">
              <label>Related</label>
              <div style={{ fontSize: 12.5 }}>
                Deliveries: {so.related.deliveries.map(d => d.ref).join(', ') || '—'}
                <br />
                Invoices: {so.related.invoices.length ? so.related.invoices.map(i => i.ref).join(', ') : 'None yet'}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="sp-panel" style={{ marginTop: 10 }}>
        <Tabs
          tabs={[
            'Order Lines',
            'Other Information',
            'Delivery and Stock',
            'Invoices',
            'Payments',
            'History',
            'Activities',
            'Attachments',
          ]}
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
                    <th className="num">Ordered</th>
                    <th className="num">Reserved</th>
                    <th className="num">Picked</th>
                    <th className="num">Delivered</th>
                    <th className="num">Invoiced</th>
                    <th>Unit</th>
                    <th className="num">Unit price</th>
                    <th>Tax</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {so.lines.map(line => (
                    <tr key={line.product}>
                      <td>{line.product}</td>
                      <td>{line.description}</td>
                      <td className="num">{line.ordered}</td>
                      <td className="num">{line.reserved}</td>
                      <td className="num">{line.picked}</td>
                      <td className="num">{line.delivered}</td>
                      <td className="num">{line.invoiced}</td>
                      <td>{line.uom}</td>
                      <td className="num">{formatKes(line.unitPrice)}</td>
                      <td>{line.taxRate}%</td>
                      <td>
                        <StatusPill label={line.status.label} tone={line.status.tone} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <TotalsPanel
              rows={[
                { label: 'Untaxed amount', value: formatKes(totals.untaxed) },
                { label: 'VAT', value: formatKes(totals.tax) },
                { label: 'Total', value: formatKes(totals.total), grand: true },
                { label: 'Paid', value: formatKes(so.paid) },
                { label: 'Balance', value: formatKes(totals.total - so.paid) },
              ]}
            />
          </>
        )}
        {tab === 'Delivery and Stock' && (
          <div className="sp-panel-pad">
            <h3 style={{ margin: '0 0 8px', fontSize: 13 }}>Stock reservation</h3>
            <div className="sp-grid-2" style={{ marginBottom: 12 }}>
              <div className="sp-field">
                <label>Reservation status</label>
                <div>{so.reservation.status}</div>
              </div>
              <div className="sp-field">
                <label>Reserved date</label>
                <div>{so.reservation.reservedAt}</div>
              </div>
              <div className="sp-field">
                <label>Reserved by</label>
                <div>{so.reservation.reservedBy}</div>
              </div>
              <div className="sp-field">
                <label>Warehouse</label>
                <div>{so.reservation.warehouse}</div>
              </div>
            </div>
            <div className="sp-banner-warn">{so.reservation.shortages}</div>
            <div className="sales-proto-actions" style={{ justifyContent: 'flex-start' }}>
              <ProtoAction primary>Reserve all available</ProtoAction>
              <ProtoAction>Reserve selected lines</ProtoAction>
              <ProtoAction>Release reservation</ProtoAction>
              <ProtoAction>Change warehouse</ProtoAction>
            </div>
          </div>
        )}
        {!['Order Lines', 'Delivery and Stock'].includes(tab) && (
          <div className="sp-panel-pad" style={{ color: 'var(--sp-text-3)' }}>
            {tab} (prototype placeholder).
          </div>
        )}
      </div>
    </PrototypeShell>
  )
}
