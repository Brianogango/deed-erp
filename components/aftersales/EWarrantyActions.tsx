'use client'

import { useState } from 'react'
import { useApp, type Warranty } from '@/lib/store'
import { warrantyShareMessage } from '@/lib/warranty/e-warranty'
import { whatsappPhoneDigits } from '@/lib/whatsapp-share'

/** Staff: the customer's e-warranty — open, download, copy the link or send it on WhatsApp. Nothing is sent automatically. */
export function EWarrantyActions({ warranty, compact = false }: { warranty: Pick<Warranty, 'id' | 'ref' | 'customerId' | 'customerName' | 'productName' | 'serialNumber' | 'endDate'>; compact?: boolean }) {
  const { contacts, showToast } = useApp()
  const [busy, setBusy] = useState(false)

  const link = async (): Promise<string | null> => {
    setBusy(true)
    try {
      const res = await fetch(`/api/warranties/link?id=${encodeURIComponent(warranty.id)}`, { cache: 'no-store' })
      const out = await res.json().catch(() => ({}))
      if (!res.ok || !out.path) { showToast(out.error || 'Could not get the e-warranty link', 'error'); return null }
      return `${window.location.origin}${out.path}`
    } finally {
      setBusy(false)
    }
  }
  const stop = (e: React.MouseEvent) => e.stopPropagation()

  const open = async (e: React.MouseEvent, print = false) => {
    stop(e)
    // Open the tab now (pop-up blockers allow it on the click), then point it at the link.
    const tab = window.open('about:blank', '_blank')
    const url = await link()
    if (!url) { tab?.close(); return }
    const target = print ? `${url}?print=1` : url
    if (tab) tab.location.href = target
    else window.location.href = target
  }
  const copy = async (e: React.MouseEvent) => {
    stop(e)
    const url = await link()
    if (!url) return
    try { await navigator.clipboard.writeText(warrantyShareMessage(warranty, url)); showToast('E-warranty message and link copied') }
    catch { window.prompt('Copy the e-warranty link', url) }
  }
  const whatsapp = async (e: React.MouseEvent) => {
    stop(e)
    const tab = window.open('about:blank', '_blank')
    const url = await link()
    if (!url) { tab?.close(); return }
    const phone = contacts.find(c => c.id === warranty.customerId)?.phone
    const digits = whatsappPhoneDigits(phone)
    const wa = `https://wa.me/${digits ?? ''}?text=${encodeURIComponent(warrantyShareMessage(warranty, url))}`
    if (tab) tab.location.href = wa
    else window.location.href = wa
    if (!digits) showToast('No phone number on this customer — pick the chat in WhatsApp', 'info')
  }

  const cls = compact ? 'btn-outline text-[10px] px-2 py-1' : 'btn-outline text-[11px]'
  return (
    <div className="flex flex-wrap gap-1.5" onClick={stop}>
      <button type="button" className={cls} disabled={busy} onClick={e => void open(e)}>{compact ? 'Open' : 'Open e-warranty'}</button>
      <button type="button" className={cls} disabled={busy} onClick={e => void open(e, true)}>{compact ? 'PDF' : 'Download PDF'}</button>
      <button type="button" className={cls} disabled={busy} onClick={e => void copy(e)}>{compact ? 'Copy' : 'Copy link'}</button>
      <button type="button" className={cls} disabled={busy} onClick={e => void whatsapp(e)}>WhatsApp</button>
    </div>
  )
}
