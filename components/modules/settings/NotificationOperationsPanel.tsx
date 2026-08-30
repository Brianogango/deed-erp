'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import SmsMessageCenter from './SmsMessageCenter'

type NotificationOps = {
  since: string
  byStatus: Record<string, number>
  byChannel: Record<string, number>
  deadLetters: number
  pendingOutbox: number
  pendingDeliveries: number
  recentFailures: Array<{
    id: string
    eventType: string
    title: string
    channel: string
    provider: string | null
    status: string
    attempts: number
    error: string | null
    updatedAt: string
    entityType: string | null
    entityId: string | null
  }>
}

const statusTone = (status: string) => {
  if (status === 'dead_letter' || status === 'failed') return 'bg-red-50 text-red-700 border-red-200'
  if (status === 'retrying' || status === 'queued' || status === 'sending') return 'bg-amber-50 text-amber-700 border-amber-200'
  if (status === 'delivered' || status === 'read' || status === 'sent') return 'bg-emerald-50 text-emerald-700 border-emerald-200'
  return 'bg-slate-50 text-slate-600 border-slate-200'
}

export default function NotificationOperationsPanel({
  showToast,
}: {
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void
}) {
  const [data, setData] = useState<NotificationOps | null>(null)
  const [loading, setLoading] = useState(false)
  const [retryingId, setRetryingId] = useState<string | null>(null)
  const [days, setDays] = useState(7)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/notifications?days=${days}`, { cache: 'no-store' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        showToast(body.error || 'Could not load notification operations', 'error')
        return
      }
      setData(body)
    } catch {
      showToast('Could not reach notification operations API', 'error')
    } finally {
      setLoading(false)
    }
  }, [days, showToast])

  useEffect(() => { void load() }, [load])

  const totals = useMemo(() => {
    const status = data?.byStatus || {}
    const delivered = (status.delivered || 0) + (status.read || 0)
    const sent = delivered + (status.sent || 0)
    const failed = (status.failed || 0) + (status.dead_letter || 0)
    const retrying = (status.retrying || 0) + (status.queued || 0) + (status.sending || 0)
    const all = Object.values(status).reduce((sum, value) => sum + Number(value || 0), 0)
    return { all, delivered, sent, failed, retrying }
  }, [data])

  const retryDeadLetter = async (deliveryId: string) => {
    setRetryingId(deliveryId)
    try {
      const res = await fetch('/api/admin/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'retry_dead_letter',
          deliveryId,
          note: 'Retried from Settings > Notifications',
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        showToast(body.error || 'Could not retry delivery', 'error')
        return
      }
      showToast('Notification queued for retry', 'success')
      await load()
    } catch {
      showToast('Could not retry delivery', 'error')
    } finally {
      setRetryingId(null)
    }
  }

  const statCards = [
    { label: 'Deliveries', value: totals.all, detail: `Last ${days} days` },
    { label: 'Delivered / read', value: totals.delivered, detail: 'Provider-confirmed' },
    { label: 'Pending / retrying', value: totals.retrying, detail: `${data?.pendingDeliveries || 0} currently queued` },
    { label: 'Dead letters', value: data?.deadLetters || 0, detail: 'Needs administrator action' },
  ]

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 sm:px-5 py-3 border-b border-gray-50">
          <div>
            <p className="text-[10.5px] font-bold text-gray-400 uppercase tracking-widest">Notification operations</p>
            <p className="text-[11px] text-gray-500 mt-1">Outbox, provider delivery, retries and dead-letter visibility.</p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={days}
              onChange={event => setDays(Number(event.target.value))}
              className="h-9 rounded-lg border border-gray-200 bg-white px-2 text-[11px] font-semibold text-gray-600"
            >
              <option value={1}>24 hours</option>
              <option value={7}>7 days</option>
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
            </select>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="h-9 rounded-lg border border-gray-200 bg-white px-3 text-[11px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 p-4 sm:p-5">
          {statCards.map(card => (
            <div key={card.label} className="rounded-xl border border-gray-100 bg-gray-50 p-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{card.label}</p>
              <p className="mt-1 text-2xl font-black text-gray-900">{card.value.toLocaleString()}</p>
              <p className="mt-1 text-[10px] text-gray-500">{card.detail}</p>
            </div>
          ))}
        </div>

        <div className="border-t border-gray-50 p-4 sm:p-5">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-gray-400">By channel</p>
              <div className="flex flex-wrap gap-2">
                {Object.keys(data?.byChannel || {}).length === 0 ? (
                  <span className="text-[11px] text-gray-400">No channel activity in this period.</span>
                ) : Object.entries(data?.byChannel || {}).map(([channel, count]) => (
                  <span key={channel} className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-[10px] font-semibold text-gray-600">
                    <span className="uppercase">{channel}</span>
                    <strong className="text-gray-900">{count}</strong>
                  </span>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-gray-400">Queue health</p>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-gray-100 px-3 py-2">
                  <p className="text-[10px] text-gray-400">Outbox pending</p>
                  <p className="text-base font-black text-gray-900">{data?.pendingOutbox || 0}</p>
                </div>
                <div className="rounded-lg border border-gray-100 px-3 py-2">
                  <p className="text-[10px] text-gray-400">Delivery pending</p>
                  <p className="text-base font-black text-gray-900">{data?.pendingDeliveries || 0}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <SmsMessageCenter showToast={showToast} />

      <section className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        <div className="px-4 sm:px-5 py-3 border-b border-gray-50">
          <p className="text-[10.5px] font-bold text-gray-400 uppercase tracking-widest">Recent delivery exceptions</p>
        </div>

        {!data || data.recentFailures.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-sm font-bold text-gray-700">No delivery exceptions</p>
            <p className="mt-1 text-[11px] text-gray-400">Failed, retrying and dead-letter deliveries will appear here.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {data.recentFailures.map(row => (
              <div key={row.id} className="p-4 sm:p-5">
                <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`inline-flex rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${statusTone(row.status)}`}>
                        {row.status.replaceAll('_', ' ')}
                      </span>
                      <span className="text-[10px] font-bold uppercase text-gray-400">{row.channel}</span>
                      {row.provider && <span className="text-[10px] text-gray-400">via {row.provider}</span>}
                      <span className="text-[10px] text-gray-400">{row.attempts} attempt{row.attempts === 1 ? '' : 's'}</span>
                    </div>
                    <p className="mt-2 text-[12px] font-bold text-gray-800">{row.title}</p>
                    <p className="mt-0.5 text-[10px] font-mono text-gray-400">{row.eventType}</p>
                    {row.error && (
                      <p className="mt-2 max-w-3xl rounded-lg bg-red-50 px-3 py-2 text-[11px] leading-relaxed text-red-700">
                        {row.error}
                      </p>
                    )}
                    <p className="mt-2 text-[10px] text-gray-400">
                      Updated {new Date(row.updatedAt).toLocaleString('en-KE')}
                      {row.entityType && row.entityId ? ` · ${row.entityType} ${row.entityId}` : ''}
                    </p>
                  </div>
                  {row.status === 'dead_letter' && (
                    <button
                      type="button"
                      onClick={() => void retryDeadLetter(row.id)}
                      disabled={retryingId === row.id}
                      className="min-h-9 shrink-0 rounded-lg bg-navy-500 px-3 text-[10px] font-bold text-white hover:bg-navy-600 disabled:opacity-50"
                    >
                      {retryingId === row.id ? 'Queueing…' : 'Retry delivery'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
