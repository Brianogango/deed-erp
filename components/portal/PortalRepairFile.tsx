'use client'

import React, { useState } from 'react'
import PortalPdfButton from '@/components/portal/PortalPdfButton'

const inputStyle: React.CSSProperties = {
  width: '100%', marginBottom: 8, background: 'var(--portal-bg)', border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 10, padding: '10px 14px', color: '#E5E7EB', fontSize: 13, outline: 'none',
}

/**
 * A repair attachment (QC or diagnosis report) on the customer pages. Files
 * served by the portal need the phone number on the repair, like the invoice
 * and receipt; a file stored elsewhere (a plain https link) opens directly.
 */
export default function PortalRepairFile({
  repairRef, url, filename, phone, onPhoneChange, style, children,
}: {
  repairRef: string
  url: string
  filename: string
  /** Shared phone field from the page, when it has one. */
  phone?: string
  onPhoneChange?: (value: string) => void
  style?: React.CSSProperties
  children: React.ReactNode
}) {
  const [ownPhone, setOwnPhone] = useState('')
  if (!url.startsWith('/api/portal/')) {
    return <a href={url} target="_blank" rel="noopener noreferrer" download={filename} style={{ textDecoration: 'none', ...style }}>{children}</a>
  }
  const value = phone ?? ownPhone
  const setValue = onPhoneChange ?? setOwnPhone
  return (
    <div>
      <input
        value={value}
        onChange={e => setValue(e.target.value)}
        placeholder="Phone number on this repair (to download)"
        inputMode="tel"
        style={inputStyle}
      />
      <PortalPdfButton repairRef={repairRef} href={url} phone={value} filename={filename} style={style}>
        {children}
      </PortalPdfButton>
    </div>
  )
}
