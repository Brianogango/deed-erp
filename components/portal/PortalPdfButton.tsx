'use client'

import React, { useState } from 'react'

/**
 * Download a repair document (quote, invoice, receipt) from the customer
 * portal. It used to be a plain link: when the server refused — no phone
 * number typed, or no invoice yet — the browser saved or showed the error
 * text instead of a PDF and the customer saw nothing useful. It now fetches
 * first and says why it could not download.
 */
export default function PortalPdfButton({
  repairRef, kind, phone, label, filename, style, children,
}: {
  repairRef: string
  kind: 'quote-pdf' | 'invoice-pdf' | 'receipt-pdf'
  phone: string
  label?: string
  filename: string
  style?: React.CSSProperties
  children?: React.ReactNode
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const download = async () => {
    if (busy) return
    setError('')
    setBusy(true)
    try {
      const url = `/api/portal/repair/${encodeURIComponent(repairRef)}/${kind}?phone=${encodeURIComponent(phone.trim())}`
      const res = await fetch(url, { cache: 'no-store' })
      const type = res.headers.get('content-type') || ''
      if (!res.ok || !type.includes('pdf')) {
        const payload = await res.json().catch(() => null) as { error?: string } | null
        let message = payload?.error || 'Could not download the document. Please try again.'
        if (res.status === 403 && !phone.trim()) message = 'Enter the phone number registered on this repair, then tap download again.'
        else if (res.status === 403) message = 'That phone number does not match this repair. Use the number you gave when dropping off the device.'
        setError(message)
        return
      }
      const blob = await res.blob()
      const href = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = href
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(href), 10_000)
    } catch {
      setError('No connection. Check your internet and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button type="button" onClick={download} disabled={busy} style={{ cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.75 : 1, width: '100%', ...style }}>
        {busy ? 'Preparing PDF…' : (children ?? label)}
      </button>
      {error && (
        <div role="alert" style={{ marginTop: 8, padding: '8px 12px', borderRadius: 10, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', fontSize: 12, color: '#F87171', textAlign: 'center' }}>
          {error}
        </div>
      )}
    </>
  )
}
