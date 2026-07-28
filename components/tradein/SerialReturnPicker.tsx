'use client'

import { useMemo, useState } from 'react'
import { Input } from '@/components/ui'
import { LocationId, useAfterSalesStore } from '@/lib/store'
import {
  isCustomerReturnEligible,
  isStockOutEligible,
  scoreCustomerReturnSerial,
} from '@/lib/tradein-serial-intake'

type SerialMode = 'customer_return' | 'stock_out'

/**
 * Dual-mode serial picker: search sold/customer serials, or register a new
 * serial that is not yet in the system (return intake only).
 */
export function SerialReturnPicker({
  productId,
  selectedIds,
  onAdd,
  onRemove,
  mode = 'customer_return',
  location,
  allowIntake = false,
  customerId,
  saleOrderId,
  intakeSource = 'trade-in',
}: {
  productId: string
  selectedIds: string[]
  onAdd: (id: string) => void
  onRemove: (id: string) => void
  mode?: SerialMode
  location?: LocationId
  /** When true (return flows), allow typing a serial that is not in the system. */
  allowIntake?: boolean
  customerId?: string
  saleOrderId?: string
  intakeSource?: string
}) {
  const { serials, saleOrders, registerCustomerReturnSerial, showToast } = useAfterSalesStore()

  const [tab, setTab] = useState<'sold' | 'intake'>('sold')
  const [q, setQ] = useState('')
  const [intakeValue, setIntakeValue] = useState('')
  const [registering, setRegistering] = useState(false)

  const available = useMemo(() => {
    const list = serials.filter(s => {
      if (s.productId !== productId) return false
      if (mode === 'customer_return') return isCustomerReturnEligible(s)
      return isStockOutEligible(s, location)
    })
    if (mode !== 'customer_return') return list
    return [...list].sort((a, b) =>
      scoreCustomerReturnSerial(b, { customerId, saleOrderId, saleOrders }) -
      scoreCustomerReturnSerial(a, { customerId, saleOrderId, saleOrders }),
    )
  }, [serials, productId, mode, location, customerId, saleOrderId, saleOrders])

  const filtered = available.filter(s => s.serial.toLowerCase().includes(q.toLowerCase()))

  const selectedSerials = selectedIds.map(id => {
    const found = serials.find(s => s.id === id)
    return found ?? { id, serial: id, status: 'pending', location: '—' }
  })

  function registerIntake() {
    const text = intakeValue.trim()
    if (!text) return
    setRegistering(true)
    try {
      const created = registerCustomerReturnSerial(productId, text, {
        saleOrderId,
        source: intakeSource,
      })
      if (created) {
        if (!selectedIds.includes(created.id)) onAdd(created.id)
        setIntakeValue('')
      } else if (!registerCustomerReturnSerial) {
        showToast('Serial intake is unavailable', 'error')
      }
    } finally {
      setRegistering(false)
    }
  }

  return (
    <div>
      {selectedSerials.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          {selectedSerials.map(s => (
            <span
              key={s.id}
              style={{
                fontSize: 10, fontFamily: 'monospace', padding: '3px 8px', borderRadius: 999,
                background: '#E8F3FA', color: 'var(--navy)', display: 'inline-flex', alignItems: 'center', gap: 6,
              }}
            >
              {s.serial}
              <button
                type="button"
                onClick={() => onRemove(s.id)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', fontWeight: 700, padding: 0 }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {allowIntake && mode === 'customer_return' && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          <button
            type="button"
            onClick={() => setTab('sold')}
            style={{
              fontSize: 10, fontWeight: 700, padding: '4px 10px', borderRadius: 8, cursor: 'pointer',
              border: tab === 'sold' ? '1px solid #A8D4E8' : '1px solid var(--border-lt)',
              background: tab === 'sold' ? '#E8F3FA' : 'transparent',
              color: tab === 'sold' ? 'var(--navy)' : 'var(--text-3)',
            }}
          >
            From sold stock
          </button>
          <button
            type="button"
            onClick={() => setTab('intake')}
            style={{
              fontSize: 10, fontWeight: 700, padding: '4px 10px', borderRadius: 8, cursor: 'pointer',
              border: tab === 'intake' ? '1px solid #FCD34D' : '1px solid var(--border-lt)',
              background: tab === 'intake' ? '#FFFBEB' : 'transparent',
              color: tab === 'intake' ? '#92400E' : 'var(--text-3)',
            }}
          >
            Enter new serial
          </button>
        </div>
      )}

      {(!allowIntake || tab === 'sold' || mode === 'stock_out') && (
        <>
          <Input value={q} onChange={setQ} placeholder="Search serial…" />
          <div style={{ maxHeight: 110, overflowY: 'auto', border: '1px solid var(--border-lt)', borderRadius: 8, marginTop: 4 }}>
            {filtered.length === 0 && <p style={{ fontSize: 11, color: 'var(--text-4)', padding: '6px 12px' }}>No serials found</p>}
            {filtered.map(s => {
              const sel = selectedIds.includes(s.id)
              const preferred = mode === 'customer_return' && scoreCustomerReturnSerial(s, { customerId, saleOrderId, saleOrders }) > 0
              return (
                <div
                  key={s.id}
                  onClick={() => (sel ? onRemove(s.id) : onAdd(s.id))}
                  style={{
                    display: 'flex', gap: 8, padding: '5px 10px', cursor: 'pointer', fontSize: 11,
                    background: sel ? '#E8F3FA' : preferred ? '#F0FDF4' : 'transparent',
                    borderBottom: '1px solid var(--bg-muted)',
                  }}
                >
                  <span style={{ flex: 1, fontFamily: 'monospace', color: 'var(--navy)' }}>{s.serial}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-4)' }}>{s.status} · {s.location}{preferred ? ' · match' : ''}</span>
                  {sel && <span style={{ color: 'var(--accent-cyan)', fontWeight: 700 }}>✓</span>}
                </div>
              )
            })}
          </div>
        </>
      )}

      {allowIntake && mode === 'customer_return' && tab === 'intake' && (
        <div style={{ marginTop: 2 }}>
          <p style={{ fontSize: 10, color: '#92400E', marginBottom: 6 }}>
            Use when the machine was never recorded in Deed (or serial is missing). Registers it as a customer-held unit, then attaches it to this return.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <Input value={intakeValue} onChange={setIntakeValue} placeholder="Type serial number…" />
            </div>
            <button
              type="button"
              className="btn-primary text-[10px] px-3"
              disabled={registering || !intakeValue.trim()}
              onClick={registerIntake}
            >
              {registering ? '…' : 'Add'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
