'use client'

/**
 * Device reconfiguration — bench flow.
 *
 * RAM and SSD use the same four moves: leave / pull one / swap / add.
 * Apply now creates the work order, moves parts stock, and rewrites this
 * unit's selling name (serial.specs). The catalog SKU name is not changed.
 */

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
import { applyBenchJob, type BenchActionKind } from '@/lib/reconfiguration/bench-action'
import { partCapacityGb } from '@/lib/reconfiguration/product-effect'

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

type SlotDraft = {
  action: BenchActionKind
  moduleCount: number
  outgoingProductId: string
  incomingProductId: string
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

const ACTIONS: Array<{ value: BenchActionKind; label: string }> = [
  { value: 'none', label: 'Leave as-is' },
  { value: 'pull_one', label: 'Pull one' },
  { value: 'swap', label: 'Swap' },
  { value: 'add_one', label: 'Add one' },
]

function emptySlot(): SlotDraft {
  return { action: 'none', moduleCount: 1, outgoingProductId: '', incomingProductId: '' }
}

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
  const [deviceConfig, setDeviceConfig] = useState<any>(null)
  const [ram, setRam] = useState<SlotDraft>(emptySlot)
  const [storage, setStorage] = useState<SlotDraft>(emptySlot)
  const [price, setPrice] = useState('')
  const [doneHint, setDoneHint] = useState<string | null>(null)

  const canCreate = CREATE_ROLES.includes(role)
  const enabled = systemSettings?.reconfigurationEnabled !== false

  const partProducts = useMemo(
    () =>
      (products || []).filter(
        (p: any) =>
          p.isActive !== false &&
          (String(p.category || '').includes('Parts') ||
            /ram|ssd|hdd|memory|storage|nvme/i.test(String(p.name || ''))),
      ),
    [products],
  )

  const ramParts = useMemo(
    () =>
      partProducts.filter((p: any) => /ram|memory|ddr/i.test(String(p.name || ''))),
    [partProducts],
  )
  const storageParts = useMemo(
    () =>
      partProducts.filter((p: any) => /ssd|hdd|nvme|storage/i.test(String(p.name || ''))),
    [partProducts],
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
    setDoneHint(null)
    if (!serialId) {
      setDeviceConfig(null)
      return
    }
    try {
      const cfg = await api<any>(`/api/reconfiguration/device/${encodeURIComponent(serialId)}/configuration`)
      setDeviceConfig(cfg)
      const ramCount = (cfg?.installed || []).filter(
        (i: any) => i.category === 'ram' || i.slotType === 'ram_slot',
      ).length
      const ssdCount = (cfg?.installed || []).filter(
        (i: any) => i.category === 'storage' || i.slotType === 'm2_slot' || i.slotType === 'sata_bay',
      ).length
      setRam({ ...emptySlot(), moduleCount: ramCount || 1 })
      setStorage({ ...emptySlot(), moduleCount: ssdCount || 1 })
    } catch (e: any) {
      setError(e.message)
    }
  }

  const preview = useMemo(() => {
    if (!deviceConfig) return null
    const ramIn = ramParts.concat(partProducts).find((p: any) => p.id === ram.incomingProductId)
    const ssdIn = storageParts.concat(partProducts).find((p: any) => p.id === storage.incomingProductId)
    return applyBenchJob({
      productName: deviceConfig.productName,
      current: deviceConfig.current || {
        totalRamGb: 0,
        ramComposition: [],
        primaryStorageGb: 0,
        storageType: 'SSD',
        displayName: deviceConfig.specs || '',
      },
      ram: {
        action: ram.action,
        currentTotalGb: Number(deviceConfig.current?.totalRamGb) || 0,
        moduleCount: ram.action === 'pull_one' ? Math.max(2, ram.moduleCount) : ram.moduleCount,
        outgoingProductId: ram.outgoingProductId || undefined,
        incoming:
          ram.incomingProductId
            ? {
                productId: ram.incomingProductId,
                capacityGb: partCapacityGb(ramIn || { id: ram.incomingProductId, name: ramIn?.name }) || 0,
                productName: ramIn?.name,
              }
            : undefined,
      },
      storage: {
        action: storage.action,
        currentTotalGb: Number(deviceConfig.current?.primaryStorageGb) || 0,
        moduleCount: storage.action === 'pull_one' ? Math.max(2, storage.moduleCount) : storage.moduleCount,
        outgoingProductId: storage.outgoingProductId || undefined,
        incoming:
          storage.incomingProductId
            ? {
                productId: storage.incomingProductId,
                capacityGb: partCapacityGb(ssdIn || { id: storage.incomingProductId, name: ssdIn?.name }) || 0,
                productName: ssdIn?.name,
              }
            : undefined,
        storageType: deviceConfig.current?.storageType || 'SSD',
      },
    })
  }, [deviceConfig, ram, storage, ramParts, storageParts, partProducts])

  async function applyNow() {
    if (!wizSerialId || !preview || preview.error) return
    setLoading(true)
    setError(null)
    setDoneHint(null)
    try {
      const ramIn = ramParts.concat(partProducts).find((p: any) => p.id === ram.incomingProductId)
      const ssdIn = storageParts.concat(partProducts).find((p: any) => p.id === storage.incomingProductId)
      const wo = await api<any>('/api/reconfiguration/bench', {
        method: 'POST',
        body: JSON.stringify({
          serialId: wizSerialId,
          ram: {
            action: ram.action,
            moduleCount: ram.action === 'pull_one' ? Math.max(2, ram.moduleCount) : ram.moduleCount,
            outgoingProductId: ram.outgoingProductId || undefined,
            incomingProductId: ram.incomingProductId || undefined,
            incomingCapacityGb: ram.incomingProductId
              ? partCapacityGb(ramIn || { id: ram.incomingProductId, name: ramIn?.name })
              : undefined,
          },
          storage: {
            action: storage.action,
            moduleCount: storage.action === 'pull_one' ? Math.max(2, storage.moduleCount) : storage.moduleCount,
            outgoingProductId: storage.outgoingProductId || undefined,
            incomingProductId: storage.incomingProductId || undefined,
            incomingCapacityGb: storage.incomingProductId
              ? partCapacityGb(ssdIn || { id: storage.incomingProductId, name: ssdIn?.name })
              : undefined,
            storageType: deviceConfig?.current?.storageType || 'SSD',
          },
          finalSellingPrice: price.trim() ? Number(price) : undefined,
        }),
      })
      setDetail(wo)
      setDoneHint(`Reprint the serial label. This unit is now: ${preview.after.displayName}`)
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
        subtitle="Pull, swap, or add RAM and SSD. This unit’s name follows the new config — the catalog SKU does not."
        count={orders.length}
        primaryAction={
          canCreate ? (
            <button type="button" className="btn-primary" onClick={() => { setTab('new'); setError(null); setDoneHint(null) }}>
              New job
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
        <div className="mx-4 mt-3 rounded-md border border-[var(--border)] bg-[var(--bg-muted)] px-3 py-2 text-sm text-[var(--text-1)]">
          {error}
        </div>
      )}
      {doneHint && (
        <div className="mx-4 mt-3 rounded-md border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-1)]">
          {doneHint}
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
        <div className="p-4 max-w-3xl space-y-5 overflow-auto">
          <div>
            <h2 className="text-lg font-semibold text-[var(--text-1)]">Bench job</h2>
            <p className="text-sm text-[var(--text-2)] mt-1">
              Pull one stick/drive so one remains, or swap the module (16↔8, 512↔256). Same for RAM and SSD.
            </p>
          </div>

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
                RAM {deviceConfig.current?.totalRamGb || 0}GB · Storage {deviceConfig.current?.primaryStorageGb || 0}GB
                {deviceConfig.current?.storageType ? ` ${deviceConfig.current.storageType}` : ''}
                {' · '}Cost {Number(deviceConfig.costBefore || 0).toLocaleString()}
              </div>
            </div>
          )}

          {deviceConfig && (
            <div className="grid md:grid-cols-2 gap-4">
              <SlotEditor
                title="RAM"
                hint="Pull one stick, or swap 16 for 8 (and the reverse)."
                draft={ram}
                onChange={setRam}
                parts={(ramParts.length ? ramParts : partProducts) as any[]}
              />
              <SlotEditor
                title="SSD / storage"
                hint="Pull one drive, or swap 512 for 256 (and the reverse)."
                draft={storage}
                onChange={setStorage}
                parts={(storageParts.length ? storageParts : partProducts) as any[]}
              />
            </div>
          )}

          {deviceConfig && preview && (
            <div className="rounded-md border border-[var(--border)] p-3 text-sm space-y-2">
              <div className="text-xs uppercase tracking-wide text-[var(--text-3)]">Name after this job</div>
              <p className="text-[var(--text-2)]">{preview.before.displayName}</p>
              <p className="font-medium text-[var(--text-1)]">{preview.after.displayName}</p>
              <p className="text-[var(--text-3)] text-xs">
                Catalog SKU name is unchanged. This serial’s specs, labels, POS, and sale line use the new name.
              </p>
              {preview.error && <p className="text-[var(--text-2)]">{preview.error}</p>}
            </div>
          )}

          {deviceConfig && (
            <label className="block">
              <span className="text-sm text-[var(--text-2)]">Selling price for this unit (optional)</span>
              <input
                type="number"
                className="form-input w-full mt-1"
                value={price}
                onChange={e => setPrice(e.target.value)}
                min={0}
                placeholder="Leave blank to keep the recommended price"
              />
            </label>
          )}

          <button
            type="button"
            className="btn-primary"
            disabled={!wizSerialId || !preview || Boolean(preview.error) || loading}
            onClick={() => void applyNow()}
          >
            Apply now
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
              <div className="font-medium mb-2">Before</div>
              <p>{detail.currentSnapshot?.displayName || '—'}</p>
            </div>
            <div className="rounded-md border border-[var(--border)] p-3">
              <div className="font-medium mb-2">After (this unit’s name)</div>
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
            <h3 className="font-medium mb-2">Removed (back to parts)</h3>
            <ul className="space-y-2 text-sm">
              {(detail.removalLines || []).map((l: any) => (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 border border-[var(--border)] rounded-md px-3 py-2">
                  <span>
                    {l.componentProduct?.name} · {l.slotType} #{l.slotNumber}
                    {l.actualRemovedAt ? ' — recorded' : ''}
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
            <h3 className="font-medium mb-2">Installed from parts</h3>
            <ul className="space-y-2 text-sm">
              {(detail.installationLines || []).map((l: any) => (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 border border-[var(--border)] rounded-md px-3 py-2">
                  <span>
                    {l.componentProduct?.name} → {l.targetSlotType} #{l.targetSlotNumber}
                    {l.installedAt ? ' — recorded' : ''}
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

function SlotEditor(props: {
  title: string
  hint: string
  draft: SlotDraft
  onChange: (next: SlotDraft) => void
  parts: Array<{ id: string; name?: string; sku?: string }>
}) {
  const { title, hint, draft, onChange, parts } = props
  const needsOut = draft.action === 'pull_one' || draft.action === 'swap'
  const needsIn = draft.action === 'swap' || draft.action === 'add_one'

  return (
    <fieldset className="rounded-md border border-[var(--border)] p-3 space-y-3">
      <legend className="text-sm font-medium px-1">{title}</legend>
      <p className="text-xs text-[var(--text-3)]">{hint}</p>
      <div className="flex flex-wrap gap-2">
        {ACTIONS.map(a => (
          <label key={a.value} className="inline-flex items-center gap-1.5 text-sm">
            <input
              type="radio"
              name={`action-${title}`}
              checked={draft.action === a.value}
              onChange={() =>
                onChange({
                  ...draft,
                  action: a.value,
                  moduleCount: a.value === 'pull_one' ? Math.max(2, draft.moduleCount) : draft.moduleCount,
                })
              }
            />
            {a.label}
          </label>
        ))}
      </div>

      {draft.action !== 'none' && (
        <label className="block text-sm">
          <span className="text-[var(--text-2)]">How many are fitted now?</span>
          <select
            className="form-select w-full mt-1"
            value={draft.moduleCount}
            onChange={e => onChange({ ...draft, moduleCount: Number(e.target.value) })}
          >
            <option value={1}>1</option>
            <option value={2}>2</option>
          </select>
        </label>
      )}

      {needsOut && (
        <label className="block text-sm">
          <span className="text-[var(--text-2)]">Pulled module becomes this part in stock</span>
          <select
            className="form-select w-full mt-1"
            value={draft.outgoingProductId}
            onChange={e => onChange({ ...draft, outgoingProductId: e.target.value })}
          >
            <option value="">Select…</option>
            {parts.map(p => (
              <option key={p.id} value={p.id}>{p.name} {p.sku ? `(${p.sku})` : ''}</option>
            ))}
          </select>
        </label>
      )}

      {needsIn && (
        <label className="block text-sm">
          <span className="text-[var(--text-2)]">Fit this part from warehouse</span>
          <select
            className="form-select w-full mt-1"
            value={draft.incomingProductId}
            onChange={e => onChange({ ...draft, incomingProductId: e.target.value })}
          >
            <option value="">Select…</option>
            {parts.map(p => (
              <option key={p.id} value={p.id}>{p.name} {p.sku ? `(${p.sku})` : ''}</option>
            ))}
          </select>
        </label>
      )}
    </fieldset>
  )
}
