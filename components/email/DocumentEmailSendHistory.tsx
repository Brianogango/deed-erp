'use client'

import { useCallback, useEffect, useState } from 'react'
import { Badge } from '@/components/ui'
import { fmtDate } from '@/lib/store'
import type { DocumentEmailDocumentType, DocumentEmailSend } from '@/lib/document-email-sends'

/**
 * Shows recorded email attempts for a quote/invoice (success + failure).
 */
export default function DocumentEmailSendHistory({
  documentId,
  documentType,
  refreshKey = 0,
  title = 'Email history',
}: {
  documentId: string
  documentType?: DocumentEmailDocumentType
  /** Bump after a send to reload. */
  refreshKey?: number
  title?: string
}) {
  const [sends, setSends] = useState<DocumentEmailSend[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!documentId) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ documentId, limit: '50' })
      if (documentType) params.set('documentType', documentType)
      const res = await fetch(`/api/document-email-sends?${params}`)
      const body = await res.json().catch(() => ({}))
      setSends(Array.isArray(body?.sends) ? body.sends : [])
    } catch {
      setSends([])
    } finally {
      setLoading(false)
    }
  }, [documentId, documentType])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  return (
    <div className="rounded-xl border border-[var(--border-lt)] bg-[var(--bg-surface)] p-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-[10px] uppercase tracking-widest font-bold text-[var(--text-4)]">{title}</p>
        {loading && <span className="text-[10px] text-[var(--text-4)]">Loading…</span>}
      </div>
      {!loading && sends.length === 0 && (
        <p className="text-xs text-[var(--text-3)]">No emails sent yet for this document.</p>
      )}
      {sends.length > 0 && (
        <div className="flex flex-col gap-2 max-h-48 overflow-y-auto">
          {sends.map(send => (
            <div
              key={send.id}
              className="rounded-lg px-2.5 py-2 text-xs"
              style={{
                background: send.status === 'success' ? 'var(--success-bg)' : 'var(--danger-bg)',
                border: `1px solid ${send.status === 'success' ? '#BBF7D0' : '#FECACA'}`,
              }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-[var(--text-1)] truncate">
                    To {send.to}
                    {send.cc?.length ? ` · Cc ${send.cc.join(', ')}` : ''}
                  </p>
                  <p className="text-[10px] text-[var(--text-3)] mt-0.5">
                    {fmtDate(send.sentAt)}
                    {send.sentByName ? ` · ${send.sentByName}` : ''}
                    {send.kind === 'update' ? ' · Update' : send.kind === 'initial' ? ' · First send' : ''}
                  </p>
                  {send.status === 'failed' && send.error && (
                    <p className="text-[10px] mt-1" style={{ color: 'var(--danger)' }}>{send.error}</p>
                  )}
                </div>
                <Badge
                  status={send.status === 'success' ? 'paid' : 'cancelled'}
                  label={send.status === 'success' ? 'Sent' : 'Failed'}
                  size="xs"
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
