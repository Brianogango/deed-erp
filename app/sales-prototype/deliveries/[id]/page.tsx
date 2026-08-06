'use client'

import { useMemo, useState } from 'react'
import { DEMO_DELIVERY } from '@/components/sales-prototype/demo-data'
import {
  ProtoAction,
  PrototypeShell,
  StatusPill,
  Tabs,
  useProtoToast,
} from '@/components/sales-prototype/shell'

export default function DeliveryPickingPrototype() {
  const dn = DEMO_DELIVERY
  const [tab, setTab] = useState('Products')
  const [activeLine, setActiveLine] = useState(0)
  const [scan, setScan] = useState('')
  const [selected, setSelected] = useState<string[]>(dn.lines[0].selectedSerials ?? [])
  const { show, toast } = useProtoToast()

  const line = dn.lines[activeLine]
  const summary = useMemo(() => {
    const required = dn.lines.reduce((s, l) => s + l.required, 0)
    const picked = dn.lines.reduce((s, l) => s + l.picked, 0)
    return {
      required,
      picked,
      remaining: required - picked,
      pct: Math.round((picked / required) * 100),
    }
  }, [dn.lines])

  function toggleSerial(serial: string) {
    setSelected(prev => {
      if (prev.includes(serial)) {
        show(`Removed ${serial}`)
        return prev.filter(s => s !== serial)
      }
      if (prev.includes(serial)) return prev
      show(`Selected ${serial}`)
      return [...prev, serial]
    })
  }

  function onScanSubmit(e: React.FormEvent) {
    e.preventDefault()
    const value = scan.trim().toUpperCase()
    if (!value) return
    const available = line.availableSerials?.map(s => s.serial) ?? []
    if (!line.serialTracked) {
      show('Quantity line — enter qty instead of serial')
      return
    }
    if (!available.includes(value)) {
      show(`Invalid serial ${value}`)
      setScan('')
      return
    }
    if (selected.includes(value)) {
      show(`Duplicate scan ${value}`)
      setScan('')
      return
    }
    setSelected(prev => [...prev, value])
    show(`Scanned ${value}`)
    setScan('')
  }

  return (
    <PrototypeShell title="Delivery and serial picking">
      <div className="sales-proto-page-header">
        <div>
          <div className="sp-ref-row">
            <h1>{dn.ref}</h1>
            <StatusPill label={dn.status.label} tone={dn.status.tone} />
          </div>
          <div className="sub">Source {dn.source} · {dn.warehouse}</div>
        </div>
        <div className="sales-proto-actions">
          <ProtoAction>Print</ProtoAction>
          <ProtoAction>Save progress</ProtoAction>
          <ProtoAction primary message="Prototype: mark as delivered (no inventory post).">
            Mark as delivered
          </ProtoAction>
        </div>
      </div>

      <div className="sp-panel sp-panel-pad">
        <div className="sp-grid-2">
          <div className="sp-field">
            <label>Delivery type</label>
            <div>{dn.type}</div>
          </div>
          <div className="sp-field">
            <label>Scheduled date</label>
            <div>{dn.scheduled}</div>
          </div>
          <div className="sp-field">
            <label>Customer</label>
            <div>{dn.customer}</div>
          </div>
          <div className="sp-field">
            <label>Responsible</label>
            <div>{dn.responsible}</div>
          </div>
          <div className="sp-field" style={{ gridColumn: '1 / -1' }}>
            <label>Delivery address</label>
            <div style={{ whiteSpace: 'pre-line' }}>{dn.address}</div>
          </div>
        </div>
      </div>

      <div className="sp-panel" style={{ marginTop: 10 }}>
        <Tabs
          tabs={['Products', 'Detailed Operations', 'Serial Numbers', 'Additional Information', 'Notes', 'History']}
          active={tab}
          onChange={setTab}
        />

        {(tab === 'Products' || tab === 'Serial Numbers') && (
          <div className="sp-panel-pad">
            <div className="sp-picking">
              <div>
                <h3 style={{ margin: '0 0 8px', fontSize: 12 }}>Product lines</h3>
                <div className="sp-table-wrap">
                  <table className="sp-table">
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th className="num">Req</th>
                        <th className="num">Picked</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dn.lines.map((l, idx) => (
                        <tr
                          key={l.product}
                          onClick={() => {
                            setActiveLine(idx)
                            setSelected(l.selectedSerials ?? [])
                          }}
                          style={{ cursor: 'pointer', background: idx === activeLine ? 'var(--sp-accent-soft)' : undefined }}
                        >
                          <td>{l.product}</td>
                          <td className="num">{l.required}</td>
                          <td className="num">{l.picked}</td>
                          <td>
                            <StatusPill label={l.status.label} tone={l.status.tone} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <h3 style={{ margin: '0 0 8px', fontSize: 12 }}>
                  {line.serialTracked ? 'Available serials' : 'Available quantity'}
                </h3>
                {line.serialTracked ? (
                  <>
                    <form onSubmit={onScanSubmit} style={{ marginBottom: 8 }}>
                      <label className="sr-only" htmlFor="barcode">
                        Barcode / serial
                      </label>
                      <input
                        id="barcode"
                        className="sp-scan"
                        placeholder="Scan or type serial…"
                        value={scan}
                        onChange={e => setScan(e.target.value)}
                        autoComplete="off"
                      />
                    </form>
                    <ul className="sp-serial-list">
                      {line.availableSerials?.map(s => (
                        <li key={s.serial} data-selected={selected.includes(s.serial) ? 'true' : 'false'}>
                          <button
                            type="button"
                            className="sp-btn sp-btn-ghost"
                            style={{ padding: 0, textAlign: 'left' }}
                            onClick={() => toggleSerial(s.serial)}
                          >
                            <strong>{s.serial}</strong>
                            <div style={{ fontSize: 10, color: 'var(--sp-text-3)' }}>
                              {s.sku} · Grade {s.grade} · {s.location}
                            </div>
                          </button>
                          <span>{selected.includes(s.serial) ? 'Selected' : 'Available'}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <div className="sp-panel sp-panel-pad">
                    <div>Available: {line.availableQty}</div>
                    <div>Reserved: {line.reservedQty}</div>
                    <div style={{ marginTop: 8 }}>
                      <label htmlFor="qty-pick">Pick quantity</label>
                      <input id="qty-pick" type="number" defaultValue={line.picked} min={0} max={line.required} />
                    </div>
                  </div>
                )}
              </div>

              <div>
                <h3 style={{ margin: '0 0 8px', fontSize: 12 }}>Selected / warnings</h3>
                <div className="sp-panel sp-panel-pad">
                  {line.serialTracked ? (
                    <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12.5 }}>
                      {selected.map(s => (
                        <li key={s}>{s}</li>
                      ))}
                      {!selected.length && <li style={{ color: 'var(--sp-text-3)' }}>None selected</li>}
                    </ul>
                  ) : (
                    <div>Picked {line.picked} / {line.required}</div>
                  )}
                  <div style={{ marginTop: 10, fontSize: 11, color: 'var(--sp-text-3)' }}>
                    From {line.sourceLocation} → {line.destLocation}
                  </div>
                </div>
              </div>
            </div>

            <div className="sp-footer-sticky">
              <div style={{ fontSize: 12.5 }}>
                Required {summary.required} · Picked {summary.picked} · Remaining {summary.remaining} ·{' '}
                <strong>{summary.pct}%</strong>
              </div>
              <ProtoAction primary success>
                Complete picking
              </ProtoAction>
            </div>
          </div>
        )}

        {!['Products', 'Serial Numbers'].includes(tab) && (
          <div className="sp-panel-pad" style={{ color: 'var(--sp-text-3)' }}>
            {tab} (prototype placeholder).
          </div>
        )}
      </div>
      {toast}
    </PrototypeShell>
  )
}
