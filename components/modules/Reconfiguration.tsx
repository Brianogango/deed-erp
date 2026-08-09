'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { ModuleHeader, TabBar, StatusStepper, ModuleSkeleton } from '@/components/ui'
import { StatusBadge, TablePageLayout, PrimaryActionButton } from '@/components/erp'
import { Fa, faScrewdriverWrench, faMagnifyingGlass } from '@/components/icons'
import { useOperationsStore } from '@/lib/store'
import { useUrlRecordId } from '@/hooks/useUrlRecordId'
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

type RailBucket = 'open' | 'approval' | 'bench' | 'done' | ''

const CREATE_ROLES = ['director', 'admin_officer', 'sales_rep', 'technical_lead', 'kilimall_officer']

const PIPELINE_STEPS: ReconfigStatus[] = [
  'draft',
  'pending_stock_check',
  'components_reserved',
  'pending_approval',
  'approved',
  'in_progress',
  'pending_qa',
  'completed',
]

const PIPELINE_LABELS: Partial<Record<ReconfigStatus, string>> = {
  draft: 'Draft',
  pending_stock_check: 'Stock check',
  components_reserved: 'Reserved',
  pending_approval: 'Approval',
  approved: 'Approved',
  in_progress: 'On bench',
  pending_qa: 'QA',
  completed: 'Done',
}

const RAIL_STATUSES: Record<Exclude<RailBucket, ''>, ReconfigStatus[]> = {
  open: ['draft', 'pending_stock_check', 'components_reserved'],
  approval: ['pending_approval'],
  bench: ['approved', 'in_progress', 'pending_qa'],
  done: ['completed'],
}

const WIZ_STEPS = ['Device', 'Target', 'Review'] as const

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string })?.error || `Request failed (${res.status})`)
  return data as T
}

function fmtGb(n: number | null | undefined) {
  return n == null ? '-' : `${n}`
}

function ConfigDelta({
  current,
  proposed,
  compact = false,
  single = false,
}: {
  current?: { totalRamGb?: number; primaryStorageGb?: number } | null
  proposed?: { totalRamGb?: number; primaryStorageGb?: number } | null
  compact?: boolean
  /** Show only one side (no arrow), using `current`. */
  single?: boolean
}) {
  const fromRam = current?.totalRamGb
  const toRam = proposed?.totalRamGb
  const fromSto = current?.primaryStorageGb
  const toSto = proposed?.primaryStorageGb
  const ramChanged = !single && fromRam != null && toRam != null && fromRam !== toRam
  const stoChanged = !single && fromSto != null && toSto != null && fromSto !== toSto

  if (single) {
    return (
      <div className={`reconfig-delta ${compact ? 'is-compact' : ''}`}>
        <span className="reconfig-delta-chip">
          <span className="reconfig-delta-key">RAM</span>
          <span className="tabular-nums font-semibold">{fmtGb(fromRam)} GB</span>
        </span>
        <span className="reconfig-delta-chip">
          <span className="reconfig-delta-key">SSD</span>
          <span className="tabular-nums font-semibold">{fmtGb(fromSto)} GB</span>
        </span>
      </div>
    )
  }

  return (
    <div className={`reconfig-delta ${compact ? 'is-compact' : ''}`}>
      <span className={`reconfig-delta-chip ${ramChanged ? 'is-changed' : ''}`}>
        <span className="reconfig-delta-key">RAM</span>
        <span className="tabular-nums">{fmtGb(fromRam)}</span>
        <span className="reconfig-delta-arrow" aria-hidden="true">
          →
        </span>
        <span className="tabular-nums font-semibold">{fmtGb(toRam)} GB</span>
      </span>
      <span className={`reconfig-delta-chip ${stoChanged ? 'is-changed' : ''}`}>
        <span className="reconfig-delta-key">SSD</span>
        <span className="tabular-nums">{fmtGb(fromSto)}</span>
        <span className="reconfig-delta-arrow" aria-hidden="true">
          →
        </span>
        <span className="tabular-nums font-semibold">{fmtGb(toSto)} GB</span>
      </span>
    </div>
  )
}

function pipelineStatus(status: ReconfigStatus): ReconfigStatus {
  if (status === 'cancelled' || status === 'reversed') return 'draft'
  return PIPELINE_STEPS.includes(status) ? status : 'draft'
}

function ReconfigurationInner() {
  const { currentUserId, users, serials, products, systemSettings } = useOperationsStore()
  const currentUser = users.find(u => u.id === currentUserId)
  const role = currentUser?.role ?? ''

  const [recordId, setRecordId] = useUrlRecordId()
  const [tab, setTab] = useState<'orders' | 'new' | 'detail'>('orders')
  const [orders, setOrders] = useState<WorkOrderListItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<any>(null)

  const [railBucket, setRailBucket] = useState<RailBucket>('')
  const [q, setQ] = useState('')
  const [qDraft, setQDraft] = useState('')

  const [wizStep, setWizStep] = useState(0)
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

  const railCounts = useMemo(() => {
    const counts = { open: 0, approval: 0, bench: 0, done: 0 }
    for (const o of orders) {
      if (RAIL_STATUSES.open.includes(o.status)) counts.open += 1
      else if (RAIL_STATUSES.approval.includes(o.status)) counts.approval += 1
      else if (RAIL_STATUSES.bench.includes(o.status)) counts.bench += 1
      else if (RAIL_STATUSES.done.includes(o.status)) counts.done += 1
    }
    return counts
  }, [orders])

  const filteredOrders = useMemo(() => {
    if (!railBucket) return orders
    const allowed = RAIL_STATUSES[railBucket]
    return orders.filter(o => allowed.includes(o.status))
  }, [orders, railBucket])

  const loadOrders = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (q.trim()) params.set('q', q.trim())
      const data = await api<WorkOrderListItem[]>(`/api/reconfiguration?${params}`)
      setOrders(Array.isArray(data) ? data : [])
    } catch (e: any) {
      setError(e.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [q])

  const loadDetail = useCallback(
    async (id: string, syncUrl = true) => {
      setLoading(true)
      setError(null)
      try {
        const data = await api<any>(`/api/reconfiguration/${id}`)
        setDetail(data)
        setTab('detail')
        if (syncUrl) setRecordId(id)
      } catch (e: any) {
        setError(e.message || 'Failed to load work order')
      } finally {
        setLoading(false)
      }
    },
    [setRecordId],
  )

  useEffect(() => {
    if (enabled && tab === 'orders') void loadOrders()
  }, [enabled, tab, loadOrders])

  useEffect(() => {
    if (!enabled || !recordId) return
    if (detail?.id === recordId && tab === 'detail') return
    void loadDetail(recordId, false)
  }, [enabled, recordId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadDevice(serialId: string) {
    setWizSerialId(serialId)
    if (!serialId) {
      setDeviceConfig(null)
      return
    }
    try {
      const cfg = await api<any>(
        `/api/reconfiguration/device/${encodeURIComponent(serialId)}/configuration`,
      )
      setDeviceConfig(cfg)
      if (cfg?.current?.totalRamGb) setWizRam(cfg.current.totalRamGb)
      if (cfg?.current?.primaryStorageGb) setWizStorage(cfg.current.primaryStorageGb)
    } catch (e: any) {
      setError(e.message)
    }
  }

  function resetWizard() {
    setWizStep(0)
    setWizSerialId('')
    setWizType('downgrade_for_sale')
    setWizScope('both')
    setWizReason('')
    setWizRam(8)
    setWizStorage(256)
    setWizRamProductId('')
    setWizStorageProductId('')
    setWizAdditive(false)
    setDeviceConfig(null)
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
            totalRamGb:
              wizScope === 'storage' ? (deviceConfig?.current?.totalRamGb ?? wizRam) : wizRam,
            primaryStorageGb:
              wizScope === 'ram'
                ? (deviceConfig?.current?.primaryStorageGb ?? wizStorage)
                : wizStorage,
            storageType: 'SSD',
            ramProductId: wizScope === 'storage' ? undefined : wizRamProductId || undefined,
            storageProductId: wizScope === 'ram' ? undefined : wizStorageProductId || undefined,
            additiveRam: wizScope === 'storage' ? false : wizAdditive,
          },
        }),
      })
      setDetail(wo)
      setTab('detail')
      setRecordId(wo.id)
      resetWizard()
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

  function goOrders() {
    setTab('orders')
    setRecordId(null)
  }

  function goNew() {
    resetWizard()
    setError(null)
    setTab('new')
    setRecordId(null)
  }

  const wizDeviceOk = Boolean(wizSerialId && deviceConfig)

  if (!enabled) {
    return (
      <div className="mod-page inventory-pilot reconfig-module p-6">
        <ModuleHeader
          title="Reconfiguration"
          subtitle="Feature disabled in system settings"
          icon={<Fa icon={faScrewdriverWrench} />}
          color="#FFFFFF"
        />
        <p className="text-[var(--text-2)] mt-4 text-sm">
          Enable reconfiguration in system settings to use this module.
        </p>
      </div>
    )
  }

  const terminal = detail && ['cancelled', 'reversed'].includes(detail.status)

  return (
    <div className="mod-page inventory-pilot reconfig-module flex flex-col h-full min-h-0">
      <ModuleHeader
        title="Reconfiguration"
        subtitle="Serialized RAM / SSD work orders with inventory-backed component moves"
        icon={<Fa icon={faScrewdriverWrench} />}
        count={orders.length}
        color="#FFFFFF"
        subtitleMode="visible"
        primaryAction={
          canCreate ? (
            <PrimaryActionButton onClick={goNew} hideLabelOnMobile={false}>
              New order
            </PrimaryActionButton>
          ) : undefined
        }
      />

      <TabBar
        tabs={[
          { id: 'orders', label: 'Work orders' },
          ...(canCreate ? [{ id: 'new', label: 'New' }] : []),
          ...(detail ? [{ id: 'detail', label: detail.ref || 'Detail' }] : []),
        ]}
        active={tab}
        onChange={id => {
          const next = id as typeof tab
          if (next === 'orders') goOrders()
          else if (next === 'new') goNew()
          else setTab(next)
        }}
      />

      {error && (
        <div
          className="mx-4 mt-3 rounded-md border px-3 py-2 text-sm"
          style={{
            borderColor: 'color-mix(in srgb, var(--danger) 35%, var(--border))',
            background: 'var(--danger-bg)',
            color: 'var(--danger-text)',
          }}
          role="alert"
        >
          {error}
          <button
            type="button"
            className="ml-3 text-xs font-semibold underline"
            onClick={() => setError(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {tab === 'orders' && (
        <div className="reconfig-body flex-1 min-h-0 overflow-auto px-3 pb-4 sm:px-4">
          <div className="inventory-pilot-rail" aria-label="Work order overview">
            {(
              [
                ['open', 'Open', railCounts.open],
                ['approval', 'Approval', railCounts.approval],
                ['bench', 'On bench', railCounts.bench],
                ['done', 'Completed', railCounts.done],
              ] as const
            ).map(([key, label, value]) => (
              <button
                key={key}
                type="button"
                className={`inventory-pilot-stat ${railBucket === key ? 'is-active' : ''} ${
                  key === 'approval' && value > 0 ? 'tone-warning' : ''
                }`}
                onClick={() => setRailBucket(prev => (prev === key ? '' : key))}
              >
                <span className="inventory-pilot-stat-value tabular-nums">{value}</span>
                <span className="inventory-pilot-stat-label">{label}</span>
              </button>
            ))}
          </div>

          <TablePageLayout title="Queue">
            <div className="flex flex-wrap gap-2 items-center p-3 border-b border-[var(--border)] inventory-pilot-search">
              <div className="relative flex-1 min-w-[12rem] max-w-md">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-4)] pointer-events-none">
                  <Fa icon={faMagnifyingGlass} className="text-[11px]" />
                </span>
                <input
                  className="form-input w-full pl-8"
                  placeholder="Search ref or serial"
                  value={qDraft}
                  onChange={e => setQDraft(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') setQ(qDraft)
                  }}
                  aria-label="Search work orders"
                />
              </div>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setQ(qDraft)
                }}
                disabled={loading}
              >
                Search
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => void loadOrders()}
                disabled={loading}
              >
                Refresh
              </button>
              {railBucket && (
                <button type="button" className="btn-secondary" onClick={() => setRailBucket('')}>
                  Clear filter
                </button>
              )}
            </div>
            <div className="responsive-table overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="text-left p-2">Ref</th>
                    <th className="text-left p-2">Serial</th>
                    <th className="text-left p-2 hidden md:table-cell">Type</th>
                    <th className="text-left p-2">Status</th>
                    <th className="text-left p-2">Config</th>
                    <th className="text-left p-2 hidden lg:table-cell">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.map(o => (
                    <tr
                      key={o.id}
                      className="cursor-pointer hover:bg-[var(--bg-muted)] border-t border-[var(--border)]"
                      onClick={() => void loadDetail(o.id)}
                    >
                      <td className="p-2 font-medium text-[var(--navy)]">{o.ref}</td>
                      <td className="p-2">
                        <div className="font-mono text-[12px] tabular-nums">{o.manufacturerSerial}</div>
                        {o.product?.name && (
                          <div className="text-[11px] text-[var(--text-3)] truncate max-w-[14rem]">
                            {o.product.name}
                          </div>
                        )}
                      </td>
                      <td className="p-2 text-[var(--text-2)] hidden md:table-cell">
                        {TRANSACTION_TYPE_LABELS[o.transactionType] || o.transactionType}
                      </td>
                      <td className="p-2">
                        <StatusBadge status={o.status} label={STATUS_LABELS[o.status] || o.status} />
                      </td>
                      <td className="p-2">
                        <ConfigDelta
                          current={o.currentSnapshot}
                          proposed={o.proposedSnapshot}
                          compact
                        />
                      </td>
                      <td className="p-2 hidden lg:table-cell font-mono text-[12px] tabular-nums text-[var(--text-2)]">
                        {Number(o.costBefore || 0).toLocaleString()} →{' '}
                        {Number(o.costAfter || 0).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                  {loading && filteredOrders.length === 0 && (
                    <tr>
                      <td colSpan={6} className="text-center text-[var(--text-3)] py-10">
                        Loading work orders…
                      </td>
                    </tr>
                  )}
                  {!loading && filteredOrders.length === 0 && (
                    <tr>
                      <td colSpan={6} className="text-center py-10">
                        <p className="text-[var(--text-2)] font-medium">No work orders in this view</p>
                        <p className="text-[12px] text-[var(--text-3)] mt-1">
                          {canCreate
                            ? 'Create an order when a sale needs a RAM or SSD change before delivery.'
                            : 'Ask sales or technical to create a reconfiguration when upgrades are sold.'}
                        </p>
                        {canCreate && (
                          <button type="button" className="btn-primary mt-3" onClick={goNew}>
                            New order
                          </button>
                        )}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </TablePageLayout>
        </div>
      )}

      {tab === 'new' && (
        <div className="reconfig-body flex-1 min-h-0 overflow-auto px-3 pb-6 sm:px-4">
          <div className="reconfig-wizard max-w-3xl">
            <div className="reconfig-wizard-head">
              <h2 className="text-base font-bold text-[var(--text-1)]">New work order</h2>
              <p className="text-[12px] text-[var(--text-3)] mt-0.5">
                {WIZ_STEPS[wizStep]} ({wizStep + 1} of {WIZ_STEPS.length})
              </p>
            </div>

            <div className="reconfig-wizard-steps" aria-hidden="true">
              {WIZ_STEPS.map((label, i) => (
                <div
                  key={label}
                  className={`reconfig-wizard-step ${i <= wizStep ? 'is-active' : ''} ${
                    i < wizStep ? 'is-done' : ''
                  }`}
                >
                  <span className="reconfig-wizard-step-dot">{i < wizStep ? '✓' : i + 1}</span>
                  <span className="reconfig-wizard-step-label">{label}</span>
                </div>
              ))}
            </div>

            <div className="reconfig-wizard-panel space-y-4">
              {wizStep === 0 && (
                <>
                  <label className="block">
                    <span className="text-[11px] font-semibold text-[var(--text-3)] block mb-1">
                      Device serial
                    </span>
                    <select
                      className="form-select w-full"
                      value={wizSerialId}
                      onChange={e => void loadDevice(e.target.value)}
                    >
                      <option value="">Select device…</option>
                      {availableDevices.map((s: any) => (
                        <option key={s.id} value={s.id}>
                          {s.serial} - {s.productName} ({s.specs || 'no specs'})
                        </option>
                      ))}
                    </select>
                  </label>

                  {deviceConfig && (
                    <div className="reconfig-device-card">
                      <div className="font-semibold text-[var(--text-1)]">
                        {deviceConfig.current?.displayName || deviceConfig.specs}
                      </div>
                      <div className="text-[12px] text-[var(--text-2)] mt-1 flex flex-wrap gap-x-3 gap-y-1">
                        <span>Status: {deviceConfig.status}</span>
                        <span>Location: {deviceConfig.location}</span>
                        <span className="font-mono tabular-nums">
                          Cost: {Number(deviceConfig.costBefore || 0).toLocaleString()}
                        </span>
                      </div>
                      <div className="mt-3">
                        <div className="text-[11px] font-semibold text-[var(--text-3)] mb-1.5">
                          Installed components
                        </div>
                        {deviceConfig.installed?.length ? (
                          <ul className="reconfig-comp-list">
                            {deviceConfig.installed.map((i: any) => (
                              <li key={i.id}>
                                <span className="font-medium">
                                  {i.slotType} #{i.slotNumber}
                                </span>
                                <span className="text-[var(--text-2)]">
                                  {i.capacityGb}GB {i.category}
                                  {i.removable ? '' : ' (onboard)'}
                                </span>
                                <span className="text-[var(--text-3)] truncate">
                                  {i.componentProductName || i.componentProductId}
                                </span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-[12px] text-[var(--warning-text)] leading-relaxed">
                            No installed components recorded. Removed parts will not return to
                            inventory automatically. After complete, add removed RAM/SSD via Inventory
                            → Stock Adjustment (Pending testing).
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}

              {wizStep === 1 && (
                <>
                  <label className="block">
                    <span className="text-[11px] font-semibold text-[var(--text-3)] block mb-1">
                      Transaction type
                    </span>
                    <select
                      className="form-select w-full"
                      value={wizType}
                      onChange={e => setWizType(e.target.value as ReconfigTransactionType)}
                    >
                      {Object.entries(TRANSACTION_TYPE_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </label>

                  <fieldset className="block">
                    <legend className="text-[11px] font-semibold text-[var(--text-3)]">
                      Change scope
                    </legend>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(
                        [
                          ['ram', 'RAM only'],
                          ['storage', 'Storage only'],
                          ['both', 'RAM and storage'],
                        ] as const
                      ).map(([value, label]) => (
                        <label
                          key={value}
                          className={`reconfig-scope-opt ${wizScope === value ? 'is-selected' : ''}`}
                        >
                          <input
                            type="radio"
                            name="changeScope"
                            className="sr-only"
                            checked={wizScope === value}
                            onChange={() => setWizScope(value)}
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                    <p className="text-[11px] text-[var(--text-3)] mt-2">
                      {wizScope === 'ram'
                        ? 'Storage stays as-is. Only RAM movements are created.'
                        : wizScope === 'storage'
                          ? 'RAM stays as-is. Only storage movements are created.'
                          : 'Either or both components may change in this work order.'}
                    </p>
                  </fieldset>

                  <label className="block">
                    <span className="text-[11px] font-semibold text-[var(--text-3)] block mb-1">
                      Reason
                    </span>
                    <textarea
                      className="form-input w-full"
                      rows={2}
                      value={wizReason}
                      onChange={e => setWizReason(e.target.value)}
                      placeholder="Why this machine is being reconfigured"
                    />
                  </label>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {(wizScope === 'ram' || wizScope === 'both') && (
                      <label className="block">
                        <span className="text-[11px] font-semibold text-[var(--text-3)] block mb-1">
                          Target RAM (GB)
                        </span>
                        <input
                          type="number"
                          className="form-input w-full font-mono tabular-nums"
                          value={wizRam}
                          onChange={e => setWizRam(Number(e.target.value))}
                        />
                      </label>
                    )}
                    {(wizScope === 'storage' || wizScope === 'both') && (
                      <label className="block">
                        <span className="text-[11px] font-semibold text-[var(--text-3)] block mb-1">
                          Target storage (GB)
                        </span>
                        <input
                          type="number"
                          className="form-input w-full font-mono tabular-nums"
                          value={wizStorage}
                          onChange={e => setWizStorage(Number(e.target.value))}
                        />
                      </label>
                    )}
                  </div>

                  {(wizScope === 'ram' || wizScope === 'both') && (
                    <label className="flex items-center gap-2 text-sm text-[var(--text-1)]">
                      <input
                        type="checkbox"
                        checked={wizAdditive}
                        onChange={e => setWizAdditive(e.target.checked)}
                      />
                      Additive RAM upgrade (keep existing modules)
                    </label>
                  )}

                  {(wizScope === 'ram' || wizScope === 'both') && (
                    <label className="block">
                      <span className="text-[11px] font-semibold text-[var(--text-3)] block mb-1">
                        RAM component product
                      </span>
                      <select
                        className="form-select w-full"
                        value={wizRamProductId}
                        onChange={e => setWizRamProductId(e.target.value)}
                      >
                        <option value="">Select…</option>
                        {partProducts.map((p: any) => (
                          <option key={p.id} value={p.id}>
                            {p.name} ({p.sku})
                          </option>
                        ))}
                      </select>
                    </label>
                  )}

                  {(wizScope === 'storage' || wizScope === 'both') && (
                    <label className="block">
                      <span className="text-[11px] font-semibold text-[var(--text-3)] block mb-1">
                        Storage component product
                      </span>
                      <select
                        className="form-select w-full"
                        value={wizStorageProductId}
                        onChange={e => setWizStorageProductId(e.target.value)}
                      >
                        <option value="">Select…</option>
                        {partProducts.map((p: any) => (
                          <option key={p.id} value={p.id}>
                            {p.name} ({p.sku})
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </>
              )}

              {wizStep === 2 && (
                <div className="space-y-3 text-sm">
                  <div className="reconfig-device-card">
                    <div className="text-[11px] font-semibold text-[var(--text-3)] mb-2">Review</div>
                    <dl className="reconfig-review-grid">
                      <div>
                        <dt>Device</dt>
                        <dd>{deviceConfig?.current?.displayName || wizSerialId}</dd>
                      </div>
                      <div>
                        <dt>Type</dt>
                        <dd>{TRANSACTION_TYPE_LABELS[wizType]}</dd>
                      </div>
                      <div>
                        <dt>Scope</dt>
                        <dd>
                          {wizScope === 'ram'
                            ? 'RAM only'
                            : wizScope === 'storage'
                              ? 'Storage only'
                              : 'RAM and storage'}
                        </dd>
                      </div>
                      <div>
                        <dt>Target</dt>
                        <dd className="font-mono tabular-nums">
                          {(wizScope === 'storage'
                            ? deviceConfig?.current?.totalRamGb
                            : wizRam) ?? '-'}
                          GB RAM /{' '}
                          {(wizScope === 'ram'
                            ? deviceConfig?.current?.primaryStorageGb
                            : wizStorage) ?? '-'}
                          GB storage
                        </dd>
                      </div>
                      <div className="reconfig-review-full">
                        <dt>Reason</dt>
                        <dd>{wizReason.trim() || '-'}</dd>
                      </div>
                    </dl>
                  </div>
                  <p className="text-[12px] text-[var(--text-3)]">
                    Creating a draft does not move stock. Reserve components after the order is
                    created.
                  </p>
                </div>
              )}
            </div>

            <div className="reconfig-wizard-actions">
              {wizStep > 0 ? (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setWizStep(s => Math.max(0, s - 1))}
                >
                  Back
                </button>
              ) : (
                <button type="button" className="btn-secondary" onClick={goOrders}>
                  Cancel
                </button>
              )}
              {wizStep < WIZ_STEPS.length - 1 ? (
                <button
                  type="button"
                  className="btn-primary"
                  disabled={wizStep === 0 ? !wizDeviceOk : !wizReason.trim()}
                  onClick={() => setWizStep(s => s + 1)}
                >
                  Continue
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-primary"
                  disabled={!wizDeviceOk || !wizReason.trim() || loading}
                  onClick={() => void createWorkOrder()}
                >
                  Create order
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === 'detail' && detail && (
        <div className="reconfig-body reconfig-workbench flex-1 min-h-0 overflow-auto px-3 pb-6 sm:px-4">
          <div className="reconfig-workbench-head">
            <button type="button" className="reconfig-back" onClick={goOrders} aria-label="Back to queue">
              ←
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-bold text-[var(--text-1)] truncate">{detail.ref}</h2>
                <StatusBadge
                  status={detail.status}
                  label={STATUS_LABELS[detail.status as ReconfigStatus] || detail.status}
                />
              </div>
              <p className="text-[12px] text-[var(--text-3)] mt-0.5 truncate">
                <span className="font-mono tabular-nums">{detail.manufacturerSerial}</span>
                {' · '}
                {TRANSACTION_TYPE_LABELS[detail.transactionType as ReconfigTransactionType] ||
                  detail.transactionType}
              </p>
            </div>
          </div>

          {!terminal && (
            <div className="reconfig-pipeline card px-3 py-3 mb-3">
              <StatusStepper
                steps={PIPELINE_STEPS}
                current={pipelineStatus(detail.status as ReconfigStatus)}
                labels={PIPELINE_LABELS as Record<string, string>}
              />
            </div>
          )}

          {terminal && (
            <div
              className="card px-4 py-3 mb-3 text-sm"
              style={{
                background: 'var(--danger-bg)',
                borderColor: 'color-mix(in srgb, var(--danger) 30%, var(--border))',
                color: 'var(--danger-text)',
              }}
            >
              This work order is {STATUS_LABELS[detail.status as ReconfigStatus] || detail.status}.
              No further bench actions are available.
            </div>
          )}

          <div className="reconfig-action-tray section-actions mb-3">
            {['pending_stock_check', 'draft', 'components_reserved'].includes(detail.status) && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => void runAction('reserve')}
                disabled={loading}
              >
                Reserve
              </button>
            )}
            {detail.status === 'components_reserved' && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => void runAction('submit-approval')}
                disabled={loading}
              >
                Submit approval
              </button>
            )}
            {detail.status === 'pending_approval' && (
              <>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => void runAction('approve', { marginOverride: true })}
                  disabled={loading}
                >
                  Approve
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => void runAction('reject', { reason: 'Rejected' })}
                  disabled={loading}
                >
                  Reject
                </button>
              </>
            )}
            {detail.status === 'approved' && (
              <button
                type="button"
                className="btn-primary"
                onClick={() => void runAction('start')}
                disabled={loading}
              >
                Start work
              </button>
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
                  Pass QA
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => void runAction('complete')}
                  disabled={loading}
                >
                  Complete
                </button>
              </>
            )}
            {!['completed', 'cancelled', 'reversed'].includes(detail.status) && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => void runAction('cancel', { reason: 'Cancelled from UI' })}
                disabled={loading}
              >
                Cancel
              </button>
            )}
          </div>

          <div className="reconfig-compare grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
            <div className="reconfig-compare-pane">
              <div className="reconfig-compare-label">Current</div>
              <p className="font-medium text-[var(--text-1)] text-sm">
                {detail.currentSnapshot?.displayName || '-'}
              </p>
              <ConfigDelta current={detail.currentSnapshot} single />
            </div>
            <div className="reconfig-compare-pane is-proposed">
              <div className="reconfig-compare-label">Proposed</div>
              <p className="font-medium text-[var(--text-1)] text-sm">
                {detail.proposedSnapshot?.displayName || '-'}
              </p>
              <ConfigDelta current={detail.currentSnapshot} proposed={detail.proposedSnapshot} />
            </div>
          </div>

          <div className="reconfig-metrics mb-4">
            <div className="reconfig-metric">
              <span className="reconfig-metric-label">Cost</span>
              <span className="reconfig-metric-value font-mono tabular-nums">
                {Number(detail.costBefore || 0).toLocaleString()} →{' '}
                {Number(detail.costAfter || 0).toLocaleString()}
              </span>
            </div>
            <div className="reconfig-metric">
              <span className="reconfig-metric-label">Selling</span>
              <span className="reconfig-metric-value font-mono tabular-nums">
                {Number(detail.finalSellingPrice ?? detail.recommendedSellingPrice ?? 0).toLocaleString()}
              </span>
            </div>
            <div className="reconfig-metric">
              <span className="reconfig-metric-label">Margin</span>
              <span className="reconfig-metric-value font-mono tabular-nums">
                {Number(detail.grossMarginPct || 0).toFixed(1)}%
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <section className="reconfig-queue">
              <h3 className="reconfig-queue-title">Remove</h3>
              <ul className="reconfig-queue-list">
                {(detail.removalLines || []).map((l: any) => (
                  <li key={l.id} className="reconfig-queue-item">
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">
                        {l.componentProduct?.name || 'Component'}
                      </div>
                      <div className="text-[11px] text-[var(--text-3)]">
                        {l.slotType} #{l.slotNumber}
                        {l.actualRemovedAt ? ' · removed' : ''}
                      </div>
                    </div>
                    {detail.status === 'in_progress' && !l.actualRemovedAt && (
                      <button
                        type="button"
                        className="btn-secondary text-[11px] px-2.5 py-1.5"
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
                        Record
                      </button>
                    )}
                  </li>
                ))}
                {!detail.removalLines?.length && (
                  <li className="reconfig-queue-empty">Nothing to remove</li>
                )}
              </ul>
            </section>

            <section className="reconfig-queue">
              <h3 className="reconfig-queue-title">Install</h3>
              <ul className="reconfig-queue-list">
                {(detail.installationLines || []).map((l: any) => (
                  <li key={l.id} className="reconfig-queue-item">
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">
                        {l.componentProduct?.name || 'Component'}
                      </div>
                      <div className="text-[11px] text-[var(--text-3)]">
                        → {l.targetSlotType} #{l.targetSlotNumber}
                        {l.installedAt ? ' · installed' : ''} · {l.reservationStatus}
                      </div>
                    </div>
                    {detail.status === 'in_progress' && !l.installedAt && (
                      <button
                        type="button"
                        className="btn-secondary text-[11px] px-2.5 py-1.5"
                        onClick={() => void runAction('record-installation', { lineId: l.id })}
                      >
                        Record
                      </button>
                    )}
                  </li>
                ))}
                {!detail.installationLines?.length && (
                  <li className="reconfig-queue-empty">Nothing to install</li>
                )}
              </ul>
            </section>
          </div>
        </div>
      )}
    </div>
  )
}

export default function Reconfiguration() {
  return (
    <Suspense fallback={<ModuleSkeleton />}>
      <ReconfigurationInner />
    </Suspense>
  )
}
