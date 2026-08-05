'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ModuleHeader, TabBar } from '@/components/ui'
import { StatusBadge, TablePageLayout } from '@/components/erp'
import { useOperationsStore } from '@/lib/store'
import {
  STATUS_LABELS,
  TRANSACTION_TYPE_LABELS,
  QA_CHECKLIST,
  type ReconfigStatus,
  type ReconfigTransactionType,
} from '@/lib/reconfiguration/types'

type WorkOrderListItem = {
  id: string
  ref: string
  status: ReconfigStatus
  transactionType: ReconfigTransactionType
  manufacturerSerial: string
  product?: { name?: string; sku?: string } | null
  currentSnapshot?: { displayName?: string; totalRamGb?: number; primaryStorageGb?: number } | null
  proposedSnapshot?: { displayName?: string; totalRamGb?: number; primaryStorageGb?: number } | null
  costBefore?: number
  costAfter?: number
  finalSellingPrice?: number | null
  recommendedSellingPrice?: number | null
  version: number
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as any)?.error || `Request failed (${res.status})`)
  return data as T
}

const CREATE_ROLES = ['director', 'admin_officer', 'sales_rep', 'technical_lead', 'kilimall_officer']

export default function Reconfiguration() {
  const { currentUserId, users, serials, products, systemSettings } = useOperationsStore()
  const currentUser = users.find(u => u.id === currentUserId)
  const role = currentUser?.role ?? ''

  const [tab, setTab] = useState<'orders' | 'new' | 'detail'>('orders')
  const [orders, setOrders] = useState<WorkOrderListItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<any>(null)

  const [statusFilter, setStatusFilter] = useState('')
  const [q, setQ] = useState('')

  const [wizSerialId, setWizSerialId] = useState('')
  const [wizType, setWizType] = useState<ReconfigTransactionType>('downgrade_for_sale')
  const [wizScope, setWizScope] = useState<'ram' | 'storage' | 'both'>('both')
  const [wizReason, setWizReason] = useState('')
  const [wizRam, setWizRam] = useState(8)
  const [wizStorage, setWizStorage] = useState(256)
  const [wizRamProductId, setWizRamProductId] = useState('')
  const [wizStorageProductId, setWizStorageProductId] = useState('')
  const [wizAdditive, setWizAdditive] = useState(false)
  const [deviceConfig, setDeviceConfig] = useState<any>(null)

  const canCreate = CREATE_ROLES.includes(role)
  const enabled = systemSettings?.reconfigurationEnabled !== false

  const partProducts = useMemo(
    () =>
      (products || []).filter(
        (p: any) =>
          p.isActive !== false &&
          (String(p.category || '').includes('Parts') ||
            /ram|ssd|hdd|memory|storage/i.test(String(p.name || ''))),
      ),
    [products],
  )

  const availableDevices = useMemo(
    () =>
      (serials || []).filter(
        (s: any) =>
          ['available', 'assigned', 'refurbishment', 'reconfiguration'].includes(s.status) &&
          s.location !== 'customer',
      ),
    [serials],
  )

  const loadOrders = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (statusFilter) params.set('status', statusFilter)
      if (q.trim()) params.set('q', q.trim())
      const data = await api<WorkOrderListItem[]>(`/api/reconfiguration?${params}`)
      setOrders(Array.isArray(data) ? data : [])
    } catch (e: any) {
      setError(e.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [statusFilter, q])

  const loadDetail = useCallback(async (id: string) => {
    setLoading(true)
    setError(null)
    try {
      const data = await api<any>(`/api/reconfiguration/${id}`)
      setDetail(data)
      setTab('detail')
    } catch (e: any) {
      setError(e.message || 'Failed to load work order')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (enabled && tab === 'orders') void loadOrders()
  }, [enabled, tab, loadOrders])

  async function loadDevice(serialId: string) {
    setWizSerialId(serialId)
    if (!serialId) {
      setDeviceConfig(null)
      return
    }
    try {
      const cfg = await api<any>(`/api/reconfiguration/device/${encodeURIComponent(serialId)}/configuration`)
      setDeviceConfig(cfg)
      if (cfg?.current?.totalRamGb) setWizRam(cfg.current.totalRamGb)
      if (cfg?.current?.primaryStorageGb) setWizStorage(cfg.current.primaryStorageGb)
    } catch (e: any) {
      setError(e.message)
    }
  }

  async function createWorkOrder() {
    setLoading(true)
    setError(null)
    try {
      const wo = await api<any>('/api/reconfiguration', {
        method: 'POST',
        body: JSON.stringify({
          serialId: wizSerialId,
          transactionType: wizType,
          reason: wizReason,
          target: {
            changeScope: wizScope,
            totalRamGb: wizScope === 'storage'
              ? (deviceConfig?.current?.totalRamGb ?? wizRam)
              : wizRam,
            primaryStorageGb: wizScope === 'ram'
              ? (deviceConfig?.current?.primaryStorageGb ?? wizStorage)
              : wizStorage,
            storageType: 'SSD',
            ramProductId: wizScope === 'storage' ? undefined : (wizRamProductId || undefined),
            storageProductId: wizScope === 'ram' ? undefined : (wizStorageProductId || undefined),
            additiveRam: wizScope === 'storage' ? false : wizAdditive,
          },
        }),
      })
      setDetail(wo)
      setTab('detail')
      await loadOrders()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function runAction(path: string, body: Record<string, unknown> = {}) {
    if (!detail?.id) return
    setLoading(true)
    setError(null)
    try {
      const data = await api<any>(`/api/reconfiguration/${detail.id}/${path}`, {
        method: 'POST',
        body: JSON.stringify({ version: detail.version, ...body }),
      })
      setDetail(data)
      await loadOrders()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  if (!enabled) {
    return (
      <div className="p-6">
        <ModuleHeader title="Device Reconfiguration" subtitle="Feature disabled in system settings" />
        <p className="text-[var(--text-2)] mt-4">
          Enable reconfiguration in system settings to use this module.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <ModuleHeader
        title="Device Reconfiguration"
        subtitle="Upgrade / downgrade serialized machines with inventory-backed component moves"
        count={orders.length}
        primaryAction={
          canCreate ? (
            <button type="button" className="btn-primary" onClick={() => { setTab('new'); setError(null) }}>
              New Work Order
            </button>
          ) : undefined
        }
      />

      <TabBar
        tabs={[
          { id: 'orders', label: 'Work Orders' },
          ...(canCreate ? [{ id: 'new', label: 'New' }] : []),
          ...(detail ? [{ id: 'detail', label: detail.ref || 'Detail' }] : []),
        ]}
        active={tab}
        onChange={id => setTab(id as typeof tab)}
      />

      {error && (
        <div className="mx-4 mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      {tab === 'orders' && (
        <TablePageLayout title="Work orders">
          <div className="flex flex-wrap gap-2 items-center p-3 border-b border-[var(--border)]">
            <input
              className="form-input"
              placeholder="Search ref or serial…"
              value={q}
              onChange={e => setQ(e.target.value)}
            />
            <select className="form-select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="">All statuses</option>
              {Object.entries(STATUS_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <button type="button" className="btn-secondary" onClick={() => void loadOrders()} disabled={loading}>
              Refresh
            </button>
          </div>
          <div className="responsive-table overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left p-2">Ref</th>
                  <th className="text-left p-2">Serial</th>
                  <th className="text-left p-2">Type</th>
                  <th className="text-left p-2">Status</th>
                  <th className="text-left p-2">Config</th>
                  <th className="text-left p-2">Cost</th>
                </tr>
              </thead>
              <tbody>
                {orders.map(o => (
                  <tr
                    key={o.id}
                    className="cursor-pointer hover:bg-[var(--bg-muted)] border-t border-[var(--border)]"
                    onClick={() => void loadDetail(o.id)}
                  >
                    <td className="p-2 font-medium">{o.ref}</td>
                    <td className="p-2">{o.manufacturerSerial}</td>
                    <td className="p-2">{TRANSACTION_TYPE_LABELS[o.transactionType] || o.transactionType}</td>
                    <td className="p-2">
                      <StatusBadge status={o.status} label={STATUS_LABELS[o.status] || o.status} />
                    </td>
                    <td className="p-2 text-[var(--text-2)]">
                      {o.currentSnapshot?.totalRamGb ?? '—'}GB/{o.currentSnapshot?.primaryStorageGb ?? '—'}GB
                      {' → '}
                      {o.proposedSnapshot?.totalRamGb ?? '—'}GB/{o.proposedSnapshot?.primaryStorageGb ?? '—'}GB
                    </td>
                    <td className="p-2">
                      {Number(o.costBefore || 0).toLocaleString()} → {Number(o.costAfter || 0).toLocaleString()}
                    </td>
                  </tr>
                ))}
                {!loading && orders.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center text-[var(--text-3)] py-8">
                      No reconfiguration work orders yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </TablePageLayout>
      )}

      {tab === 'new' && (
        <div className="p-4 max-w-3xl space-y-4 overflow-auto">
          <h2 className="text-lg font-semibold text-[var(--text-1)]">New reconfiguration</h2>

          <label className="block">
            <span className="text-sm text-[var(--text-2)]">Device serial</span>
            <select className="form-select w-full mt-1" value={wizSerialId} onChange={e => void loadDevice(e.target.value)}>
              <option value="">Select device…</option>
              {availableDevices.map((s: any) => (
                <option key={s.id} value={s.id}>
                  {s.serial} — {s.productName} ({s.specs || 'no specs'})
                </option>
              ))}
            </select>
          </label>

          {deviceConfig && (
            <div className="rounded-md border border-[var(--border)] bg-[var(--bg-surface)] p-3 text-sm">
              <div className="font-medium">{deviceConfig.current?.displayName || deviceConfig.specs}</div>
              <div className="text-[var(--text-2)] mt-1">
                Status: {deviceConfig.status} · Location: {deviceConfig.location} · Cost:{' '}
                {Number(deviceConfig.costBefore || 0).toLocaleString()}
              </div>
              <div className="mt-2">
                <div className="text-xs uppercase tracking-wide text-[var(--text-3)] mb-1">Installed components</div>
                {deviceConfig.installed?.length ? (
                  <ul className="list-disc pl-5">
                    {deviceConfig.installed.map((i: any) => (
                      <li key={i.id}>
                        {i.slotType} #{i.slotNumber}: {i.capacityGb}GB {i.category}
                        {i.removable ? '' : ' (onboard)'} — {i.componentProductName || i.componentProductId}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-amber-700">
                    No installed components recorded. Seed them via the configuration API before a precise physical diff.
                  </p>
                )}
              </div>
            </div>
          )}

          <label className="block">
            <span className="text-sm text-[var(--text-2)]">Transaction type</span>
            <select className="form-select w-full mt-1" value={wizType} onChange={e => setWizType(e.target.value as ReconfigTransactionType)}>
              {Object.entries(TRANSACTION_TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </label>

          <fieldset className="block">
            <legend className="text-sm text-[var(--text-2)]">Change scope</legend>
            <div className="mt-2 flex flex-wrap gap-3 text-sm">
              {([
                ['ram', 'RAM only'],
                ['storage', 'SSD / storage only'],
                ['both', 'RAM and storage'],
              ] as const).map(([value, label]) => (
                <label key={value} className="inline-flex items-center gap-2">
                  <input
                    type="radio"
                    name="changeScope"
                    checked={wizScope === value}
                    onChange={() => setWizScope(value)}
                  />
                  {label}
                </label>
              ))}
            </div>
            <p className="text-xs text-[var(--text-3)] mt-1">
              {wizScope === 'ram'
                ? 'Storage stays as-is. Only RAM removal/install movements are created.'
                : wizScope === 'storage'
                  ? 'RAM stays as-is. Only storage removal/install movements are created.'
                  : 'Either or both components may change in this work order.'}
            </p>
          </fieldset>

          <label className="block">
            <span className="text-sm text-[var(--text-2)]">Reason</span>
            <textarea className="form-input w-full mt-1" rows={2} value={wizReason} onChange={e => setWizReason(e.target.value)} />
          </label>

          <div className="grid grid-cols-2 gap-3">
            {(wizScope === 'ram' || wizScope === 'both') && (
              <label className="block">
                <span className="text-sm text-[var(--text-2)]">Target RAM (GB)</span>
                <input type="number" className="form-input w-full mt-1" value={wizRam} onChange={e => setWizRam(Number(e.target.value))} />
              </label>
            )}
            {(wizScope === 'storage' || wizScope === 'both') && (
              <label className="block">
                <span className="text-sm text-[var(--text-2)]">Target storage (GB)</span>
                <input type="number" className="form-input w-full mt-1" value={wizStorage} onChange={e => setWizStorage(Number(e.target.value))} />
              </label>
            )}
          </div>

          {(wizScope === 'ram' || wizScope === 'both') && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={wizAdditive} onChange={e => setWizAdditive(e.target.checked)} />
              Additive RAM upgrade (keep existing modules)
            </label>
          )}

          {(wizScope === 'ram' || wizScope === 'both') && (
            <label className="block">
              <span className="text-sm text-[var(--text-2)]">RAM component product</span>
              <select className="form-select w-full mt-1" value={wizRamProductId} onChange={e => setWizRamProductId(e.target.value)}>
                <option value="">Select…</option>
                {partProducts.map((p: any) => (
                  <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>
                ))}
              </select>
            </label>
          )}

          {(wizScope === 'storage' || wizScope === 'both') && (
            <label className="block">
              <span className="text-sm text-[var(--text-2)]">Storage component product</span>
              <select className="form-select w-full mt-1" value={wizStorageProductId} onChange={e => setWizStorageProductId(e.target.value)}>
                <option value="">Select…</option>
                {partProducts.map((p: any) => (
                  <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>
                ))}
              </select>
            </label>
          )}

          <button
            type="button"
            className="btn-primary"
            disabled={!wizSerialId || !wizReason.trim() || loading}
            onClick={() => void createWorkOrder()}
          >
            Create work order
          </button>
        </div>
      )}

      {tab === 'detail' && detail && (
        <div className="p-4 space-y-4 overflow-auto">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">{detail.ref}</h2>
              <p className="text-sm text-[var(--text-2)]">
                {detail.manufacturerSerial} · {TRANSACTION_TYPE_LABELS[detail.transactionType as ReconfigTransactionType]}
              </p>
              <div className="mt-1">
                <StatusBadge status={detail.status} label={STATUS_LABELS[detail.status as ReconfigStatus] || detail.status} />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {['pending_stock_check', 'draft', 'components_reserved'].includes(detail.status) && (
                <button type="button" className="btn-secondary" onClick={() => void runAction('reserve')} disabled={loading}>Reserve</button>
              )}
              {detail.status === 'components_reserved' && (
                <button type="button" className="btn-secondary" onClick={() => void runAction('submit-approval')} disabled={loading}>Submit approval</button>
              )}
              {detail.status === 'pending_approval' && (
                <>
                  <button type="button" className="btn-primary" onClick={() => void runAction('approve', { marginOverride: true })} disabled={loading}>Approve</button>
                  <button type="button" className="btn-secondary" onClick={() => void runAction('reject', { reason: 'Rejected' })} disabled={loading}>Reject</button>
                </>
              )}
              {detail.status === 'approved' && (
                <button type="button" className="btn-primary" onClick={() => void runAction('start')} disabled={loading}>Start work</button>
              )}
              {['in_progress', 'pending_qa'].includes(detail.status) && (
                <>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={loading}
                    onClick={() =>
                      void runAction('submit-qa', {
                        results: QA_CHECKLIST.map(c => ({ checkKey: c.key, result: 'pass' })),
                      })
                    }
                  >
                    Pass QA checklist
                  </button>
                  <button type="button" className="btn-primary" onClick={() => void runAction('complete')} disabled={loading}>Complete</button>
                </>
              )}
              {!['completed', 'cancelled', 'reversed'].includes(detail.status) && (
                <button type="button" className="btn-secondary" onClick={() => void runAction('cancel', { reason: 'Cancelled from UI' })} disabled={loading}>Cancel</button>
              )}
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-4 text-sm">
            <div className="rounded-md border border-[var(--border)] p-3">
              <div className="font-medium mb-2">Current</div>
              <p>{detail.currentSnapshot?.displayName || '—'}</p>
            </div>
            <div className="rounded-md border border-[var(--border)] p-3">
              <div className="font-medium mb-2">Proposed</div>
              <p>{detail.proposedSnapshot?.displayName || '—'}</p>
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-3 text-sm">
            <div className="rounded-md bg-[var(--bg-muted)] p-3">
              <div className="text-[var(--text-3)] text-xs">Cost</div>
              <div>{Number(detail.costBefore || 0).toLocaleString()} → {Number(detail.costAfter || 0).toLocaleString()}</div>
            </div>
            <div className="rounded-md bg-[var(--bg-muted)] p-3">
              <div className="text-[var(--text-3)] text-xs">Selling price</div>
              <div>{Number(detail.finalSellingPrice ?? detail.recommendedSellingPrice ?? 0).toLocaleString()}</div>
            </div>
            <div className="rounded-md bg-[var(--bg-muted)] p-3">
              <div className="text-[var(--text-3)] text-xs">Gross margin</div>
              <div>{Number(detail.grossMarginPct || 0).toFixed(1)}%</div>
            </div>
          </div>

          <section>
            <h3 className="font-medium mb-2">Components to remove</h3>
            <ul className="space-y-2 text-sm">
              {(detail.removalLines || []).map((l: any) => (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 border border-[var(--border)] rounded-md px-3 py-2">
                  <span>
                    {l.componentProduct?.name} · {l.slotType} #{l.slotNumber}
                    {l.actualRemovedAt ? ' ✓ removed' : ''}
                  </span>
                  {detail.status === 'in_progress' && !l.actualRemovedAt && (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() =>
                        void runAction('record-removal', {
                          lineId: l.id,
                          dataStatus:
                            l.slotType === 'm2_slot' || l.slotType === 'sata_bay'
                              ? 'awaiting_sanitisation'
                              : undefined,
                          disposition: 'pending_testing',
                        })
                      }
                    >
                      Record removal
                    </button>
                  )}
                </li>
              ))}
              {!detail.removalLines?.length && <li className="text-[var(--text-3)]">None</li>}
            </ul>
          </section>

          <section>
            <h3 className="font-medium mb-2">Components to install</h3>
            <ul className="space-y-2 text-sm">
              {(detail.installationLines || []).map((l: any) => (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 border border-[var(--border)] rounded-md px-3 py-2">
                  <span>
                    {l.componentProduct?.name} → {l.targetSlotType} #{l.targetSlotNumber}
                    {l.installedAt ? ' ✓ installed' : ''} · {l.reservationStatus}
                  </span>
                  {detail.status === 'in_progress' && !l.installedAt && (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => void runAction('record-installation', { lineId: l.id })}
                    >
                      Record install
                    </button>
                  )}
                </li>
              ))}
              {!detail.installationLines?.length && <li className="text-[var(--text-3)]">None</li>}
            </ul>
          </section>
        </div>
      )}
    </div>
  )
}
