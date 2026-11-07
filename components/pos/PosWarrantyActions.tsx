'use client'

import { useEffect, useState } from 'react'
import { useApp } from '@/lib/store'
import { issuePosWarranties, type LinkedWarranty } from '@/lib/warranty/client'
import { whatsappPhoneDigits } from '@/lib/whatsapp-share'

/**
 * POS "Order complete": the sale's warranties, ready to send on WhatsApp or
 * open, without leaving the till. Nothing is sent automatically.
 */
export function PosWarrantyActions({ order }: { order: { id: string; ref: string; date?: string; customerId?: string; customerName?: string; lines: Array<{ productId: string; productName?: string; serialId?: string }> } }) {
  const { contacts } = useApp()
  const [list, setList] = useState<LinkedWarranty[] | null>(null)
  useEffect(() => {
    let cancelled = false
    void issuePosWarranties(order).then(rows => { if (!cancelled) setList(rows) })
    return () => { cancelled = true }
  }, [order.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!order.lines.some(l => l.serialId)) return null
  if (list === null) return <p className="text-[11px] text-t3 text-center">Preparing the warranty…</p>
  if (!list.length) return null

  const phone = contacts.find(c => c.id === order.customerId)?.phone
  const digits = whatsappPhoneDigits(phone)
  const first = String(order.customerName || '').trim().split(/\s+/)[0]
  const message = [
    `Hello${first ? ` ${first}` : ''}, thank you for buying from Deed Technologies. Your warrant${list.length === 1 ? 'y' : 'ies'}:`,
    ...list.map(w => `• ${w.ref} — ${w.productName} (serial ${w.serialNumber}), valid until ${new Date(`${w.endDate}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}: ${w.url}`),
    'Warranty support: 0113 704 451',
  ].join('\n')

  return (
    <div className="rounded-lg border border-[var(--border-lt)] p-3 text-[12px] flex flex-col gap-2">
      <p className="font-semibold text-t1">Warrant{list.length === 1 ? 'y' : 'ies'} {list.map(w => w.ref).join(', ')} — on the receipt</p>
      <div className="flex flex-wrap gap-2">
        <a className="btn-primary min-h-[40px] flex-1 text-center" target="_blank" rel="noreferrer" href={`https://wa.me/${digits ?? ''}?text=${encodeURIComponent(message)}`}>
          Send warranty on WhatsApp
        </a>
        {list.length === 1 && (
          <a className="btn-outline min-h-[40px]" target="_blank" rel="noreferrer" href={list[0].url}>Open certificate</a>
        )}
      </div>
      {!digits && <p className="text-[10px] text-t3">No phone on this customer — pick the chat in WhatsApp.</p>}
    </div>
  )
}
