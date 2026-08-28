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
import { PrimaryActionButton, StatusBadge, TablePageLayout } from '@/components/erp'
import { Fa, faArrowRight, faHardDrive, faMemory, faMicrochip } from '@/components/icons'
import { fmtKes, useOperationsStore } from '@/lib/store'
import {
  STATUS_LABELS,
  TRANSACTION_TYPE_LABELS,
  QA_CHECKLIST,
  type ReconfigStatus,
  type ReconfigTransactionType,
} from '@/lib/reconfiguration/types'
import { applyBenchJob, type BenchActionKind } from '@/lib/reconfiguration/bench-action'
import { ramComponentProducts, storageComponentProducts } from '@/lib/reconfiguration/part-catalog'
import { partCapacityGb } from '@/lib/reconfiguration/product-effect'
import { unitSellingName } from '@/lib/reconfiguration/unit-selling-name'
import { UNIT_CONFIG_SOURCE_LABEL, type UnitConfigSource } from '@/lib/reconfiguration/unit-config'
import SearchablePick from '@/components/reconfiguration/SearchablePick'

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

function reconfigurationNextAction(status: ReconfigStatus) {
  if (status === 'draft' || status === 'pending_stock_check') return 'Check stock'
  if (status === 'components_reserved') return 'Submit approval'
  if (status === 'pending_approval') return 'Review'
  if (status === 'approved') return 'Start work'
  if (status === 'in_progress') return 'Record work'
  if (status === 'pending_qa') return 'Run QA'
  return 'View'
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

function findPart(
  id: string,
  lists: Array<Array<{ id: string; name?: string; specs?: unknown }>>,
): { id: string; name?: string; specs?: unknown } | undefined {
  for (const list of lists) {
    const found = list.find(p => p.id === id)
    if (found) return found
  }
  return undefined
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
  const [manualRamGb, setManualRamGb] = useState('')
  const [manualStorageGb, setManualStorageGb] = useState('')

  const canCreate = CREATE_ROLES.includes(role)
  const enabled = systemSettings?.reconfigurationEnabled !== false

  const ramParts = useMemo(() => ramComponentProducts(products), [products])
  const storageParts = useMemo(() => storageComponentProducts(products), [products])
  const partProducts = useMemo(
    () => [...ramParts, ...storageParts.filter(p => !ramParts.some(r => r.id === p.id))],
    [ramParts, storageParts],
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
    setManualRamGb('')
    setManualStorageGb('')
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

  const configSource = (deviceConfig?.configSource || 'unresolved') as UnitConfigSource
  const unresolved = configSource === 'unresolved'
  const currentRamGb = Number(deviceConfig?.current?.totalRamGb) || Number(manualRamGb) || 0
  const currentStorageGb = Number(deviceConfig?.current?.primaryStorageGb) || Number(manualStorageGb) || 0

  const preview = useMemo(() => {
    if (!deviceConfig) return null
    const ramIn = findPart(ram.incomingProductId, [ramParts, partProducts])
    const ssdIn = findPart(storage.incomingProductId, [storageParts, partProducts])
    return applyBenchJob({
      productName: deviceConfig.productName,
      current: {
        ...(deviceConfig.current || {
          totalRamGb: 0,
          ramComposition: [],
          primaryStorageGb: 0,
          storageType: 'SSD',
          displayName: deviceConfig.specs || '',
        }),
        totalRamGb: currentRamGb,
        primaryStorageGb: currentStorageGb,
      },
      ram: {
        action: ram.action,
        currentTotalGb: currentRamGb,
        moduleCount: ram.action === 'pull_one' ? Math.max(2, ram.moduleCount) : ram.moduleCount,
        outgoingProductId: ram.outgoingProductId || undefined,
        incoming:
          ram.incomingProductId
            ? {
                productId: ram.incomingProductId,
                capacityGb: partCapacityGb({
                  id: ram.incomingProductId,
                  name: ramIn?.name,
                  specs: ramIn?.specs,
                }) || 0,
                productName: ramIn?.name,
              }
            : undefined,
      },
      storage: {
        action: storage.action,
        currentTotalGb: currentStorageGb,
        moduleCount: storage.action === 'pull_one' ? Math.max(2, storage.moduleCount) : storage.moduleCount,
        outgoingProductId: storage.outgoingProductId || undefined,
        incoming:
          storage.incomingProductId
            ? {
                productId: storage.incomingProductId,
                capacityGb: partCapacityGb({
                  id: storage.incomingProductId,
                  name: ssdIn?.name,
                  specs: ssdIn?.specs,
                }) || 0,
                productName: ssdIn?.name,
              }
            : undefined,
        storageType: deviceConfig.current?.storageType || 'SSD',
      },
    })
  }, [deviceConfig, ram, storage, ramParts, storageParts, partProducts, currentRamGb, currentStorageGb])

  const applyBlocked = useMemo(() => {
    if (!deviceConfig) return null
    if (!preview) return 'Choose a RAM or SSD action.'
    if (preview.error) return preview.error
    if (unresolved && ram.action !== 'none' && !currentRamGb) {
      return 'Enter the current RAM size in GB so the new total can be calculated.'
    }
    if (unresolved && storage.action !== 'none' && !currentStorageGb) {
      return 'Enter the current SSD size in GB so the new total can be calculated.'
    }
    return null
  }, [deviceConfig, preview, unresolved, ram.action, storage.action, currentRamGb, currentStorageGb])

  async function applyNow() {
    if (!wizSerialId || !preview || preview.error || applyBlocked) return
    setLoading(true)
    setError(null)
    setDoneHint(null)
    try {
      const ramIn = findPart(ram.incomingProductId, [ramParts, partProducts])
      const ssdIn = findPart(storage.incomingProductId, [storageParts, partProducts])
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
              ? partCapacityGb({
                  id: ram.incomingProductId,
                  name: ramIn?.name,
                  specs: ramIn?.specs,
                })
              : undefined,
          },
          storage: {
            action: storage.action,
            moduleCount: storage.action === 'pull_one' ? Math.max(2, storage.moduleCount) : storage.moduleCount,
            outgoingProductId: storage.outgoingProductId || undefined,
            incomingProductId: storage.incomingProductId || undefined,
            incomingCapacityGb: storage.incomingProductId
              ? partCapacityGb({
                  id: storage.incomingProductId,
                  name: ssdIn?.name,
                  specs: ssdIn?.specs,
                })
              : undefined,
            storageType: deviceConfig?.current?.storageType || 'SSD',
          },
          currentRamGb: currentRamGb || undefined,
          currentStorageGb: currentStorageGb || undefined,
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
      <div className="mod-page reconfig-page">
        <ModuleHeader
          title="Device reconfiguration"
          subtitle="Feature disabled in system settings"
          icon={<Fa icon={faMicrochip} />}
          color="var(--navy)"
          subtitleMode="visible"
        />
        <div className="mod-body">
          <p className="reconfig-disabled-copy">
            Enable reconfiguration in system settings to use this module.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="mod-page reconfig-page">
      <ModuleHeader
        title="Device reconfiguration"
        subtitle="Serialized upgrades with stock control and QA"
        icon={<Fa icon={faMicrochip} />}
        color="var(--navy)"
        subtitleMode="visible"
        count={orders.length}
        primaryAction={
          canCreate ? (
            <PrimaryActionButton
              hideLabelOnMobile={false}
              onClick={() => { setTab('new'); setError(null); setDoneHint(null) }}
            >
              New job
            </PrimaryActionButton>
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
        ariaLabel="Reconfiguration sections"
      />

      <div className="mod-body reconfig-body" aria-busy={loading}>
      <section className="reconfig-summary" aria-label="Reconfiguration overview">
        <button type="button" onClick={() => { setTab('orders'); setStatusFilter('') }}>
          <span>Needs action</span>
          <strong>{orders.filter(order => ['pending_stock_check', 'components_reserved', 'pending_approval', 'approved'].includes(order.status)).length}</strong>
          <small>Stock checks and approvals</small>
        </button>
        <button type="button" onClick={() => { setTab('orders'); setStatusFilter('in_progress') }}>
          <span>In progress</span>
          <strong>{orders.filter(order => order.status === 'in_progress').length}</strong>
          <small>Technician work underway</small>
        </button>
        <button type="button" onClick={() => { setTab('orders'); setStatusFilter('pending_qa') }}>
          <span>Awaiting QA</span>
          <strong>{orders.filter(order => order.status === 'pending_qa').length}</strong>
          <small>Ready for verification</small>
        </button>
        <button type="button" onClick={() => { setTab('orders'); setStatusFilter('completed') }}>
          <span>Completed</span>
          <strong>{orders.filter(order => order.status === 'completed').length}</strong>
          <small>Final configuration applied</small>
        </button>
      </section>
      {error && (
        <div className="reconfig-banner reconfig-banner--danger" role="alert">
          {error}
        </div>
      )}
      {doneHint && (
        <div className="reconfig-banner reconfig-banner--success" role="status">
          {doneHint}
        </div>
      )}

      {tab === 'orders' && (
        <TablePageLayout title="Work orders">
          <div className="reconfig-toolbar">
            <input
              className="form-input reconfig-toolbar-search"
              placeholder="Search ref, serial, device or SKU…"
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
          <div className="reconfig-table-wrap">
            <table className="reconfig-table">
              <thead>
                <tr>
                  <th>Ref</th>
                  <th>Serial</th>
                  <th>Device / type</th>
                  <th>Status</th>
                  <th>Change</th>
                  <th>Cost</th>
                  <th>Next action</th>
                </tr>
              </thead>
              <tbody>
                {orders.map(o => (
                  <tr
                    key={o.id}
                    className="reconfig-table-row"
                    onClick={() => void loadDetail(o.id)}
                  >
                    <td data-label="Ref" className="reconfig-table-ref">{o.ref}</td>
                    <td data-label="Serial" className="reconfig-table-serial">{o.manufacturerSerial}</td>
                    <td data-label="Device / type">
                      <span className="reconfig-table-device">
                        <strong>{o.product?.name || o.currentSnapshot?.displayName || 'Serialized device'}</strong>
                        <small>{TRANSACTION_TYPE_LABELS[o.transactionType] || o.transactionType}</small>
                      </span>
                    </td>
                    <td data-label="Status">
                      <StatusBadge status={o.status} label={STATUS_LABELS[o.status] || o.status} />
                    </td>
                    <td data-label="Config">
                      <span className="reconfig-table-config">
                        <span>{o.currentSnapshot?.totalRamGb ?? '—'}GB/{o.currentSnapshot?.primaryStorageGb ?? '—'}GB</span>
                        <Fa icon={faArrowRight} className="reconfig-table-arrow" />
                        <span>{o.proposedSnapshot?.totalRamGb ?? '—'}GB/{o.proposedSnapshot?.primaryStorageGb ?? '—'}GB</span>
                      </span>
                    </td>
                    <td data-label="Cost">
                      <span className="reconfig-table-cost">
                        {fmtKes(o.costBefore)}
                        <Fa icon={faArrowRight} className="reconfig-table-arrow" />
                        {fmtKes(o.costAfter)}
                      </span>
                    </td>
                    <td data-label="Next action">
                      <span className="reconfig-next-action">{reconfigurationNextAction(o.status)}</span>
                    </td>
                  </tr>
                ))}
                {!loading && orders.length === 0 && (
                  <tr className="reconfig-table-empty">
                    <td colSpan={7}>No reconfiguration work orders yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </TablePageLayout>
      )}

      {tab === 'new' && (
        <div className="reconfig-bench">
          <header className="reconfig-bench-intro">
            <h2>Bench job</h2>
            <p>
              Pull one stick/drive so one remains, or swap the module (16↔8, 512↔256). Same for RAM and SSD.
            </p>
          </header>

          <SearchablePick
            label="Device serial"
            value={wizSerialId}
            placeholder="Search serial or model…"
            emptyText="No matching devices in stock"
            options={availableDevices.map((s: any) => ({
              id: s.id,
              label: `${s.serial} — ${unitSellingName({ productName: s.productName, specs: s.specs })}`,
            }))}
            onChange={id => void loadDevice(id)}
          />

          {deviceConfig && (
            <div className="reconfig-device reconfig-device--selected">
              <div className="reconfig-device-name">
                {deviceConfig.current?.displayName || deviceConfig.specs || deviceConfig.productName}
              </div>
              <div className="reconfig-spec-row">
                <span className="reconfig-spec">
                  <strong>RAM</strong> {currentRamGb || 0}GB
                </span>
                <span className="reconfig-spec">
                  <strong>Storage</strong> {currentStorageGb || 0}GB
                  {deviceConfig.current?.storageType ? ` ${deviceConfig.current.storageType}` : ''}
                </span>
                <span className="reconfig-spec">
                  <strong>Cost</strong> {fmtKes(deviceConfig.costBefore)}
                </span>
              </div>
              <p className="reconfig-device-source">
                {UNIT_CONFIG_SOURCE_LABEL[configSource]}
              </p>
              {unresolved && (
                <div className="reconfig-manual-grid">
                  <label className="reconfig-field">
                    <span>Current RAM (GB)</span>
                    <input
                      type="number"
                      min={0}
                      className="form-input w-full"
                      value={manualRamGb}
                      onChange={e => setManualRamGb(e.target.value)}
                      placeholder="e.g. 8"
                    />
                  </label>
                  <label className="reconfig-field">
                    <span>Current SSD (GB)</span>
                    <input
                      type="number"
                      min={0}
                      className="form-input w-full"
                      value={manualStorageGb}
                      onChange={e => setManualStorageGb(e.target.value)}
                      placeholder="e.g. 256"
                    />
                  </label>
                </div>
              )}
            </div>
          )}

          {deviceConfig && (
            <div className="reconfig-slots">
              <SlotEditor
                title="RAM"
                hint="Pull one stick, or swap 16 for 8 (and the reverse)."
                draft={ram}
                onChange={setRam}
                parts={ramParts as any[]}
              />
              <SlotEditor
                title="SSD / storage"
                hint="Pull one drive, or swap 512 for 256 (and the reverse)."
                draft={storage}
                onChange={setStorage}
                parts={storageParts as any[]}
              />
            </div>
          )}

          {deviceConfig && preview && (
            <div className="reconfig-compare">
              <h3>This unit’s name</h3>
              <div className="reconfig-compare-grid">
                <div className="reconfig-compare-col">
                  <p className="reconfig-compare-heading">Now</p>
                  <p className="reconfig-compare-value">{preview.before.displayName}</p>
                </div>
                <Fa icon={faArrowRight} className="reconfig-compare-arrow" />
                <div className="reconfig-compare-col is-after">
                  <p className="reconfig-compare-heading">After this job</p>
                  <p className="reconfig-compare-value">{preview.after.displayName}</p>
                </div>
              </div>
              <p className="reconfig-compare-hint">
                Catalog SKU name is unchanged. This serial’s specs, labels, POS, and sale line use the new name.
              </p>
              {preview.error && <p className="reconfig-compare-error">{preview.error}</p>}
            </div>
          )}

          {deviceConfig && (
            <label className="reconfig-field">
              <span>Selling price for this unit (optional)</span>
              <input
                type="number"
                className="form-input w-full"
                value={price}
                onChange={e => setPrice(e.target.value)}
                min={0}
                placeholder="Leave blank to keep the recommended price"
              />
            </label>
          )}

          <div className="reconfig-apply-bar reconfig-bench-actions">
            <button
              type="button"
              className="btn-primary"
              disabled={!wizSerialId || loading || Boolean(applyBlocked)}
              onClick={() => void applyNow()}
            >
              Apply now
            </button>
            {applyBlocked && applyBlocked !== preview?.error ? (
              <p className="reconfig-compare-error">{applyBlocked}</p>
            ) : null}
          </div>
        </div>
      )}

      {tab === 'detail' && detail && (
        <div className="reconfig-detail">
          <div className="reconfig-detail-head">
            <button
              type="button"
              className="btn-outline reconfig-detail-back"
              aria-label="Back to reconfiguration work orders"
              onClick={() => { setDetail(null); setTab('orders') }}
            >
              ← Work orders
            </button>
            <div className="reconfig-detail-titleblock">
              <h2>{detail.ref}</h2>
              <p>
                {detail.manufacturerSerial} · {TRANSACTION_TYPE_LABELS[detail.transactionType as ReconfigTransactionType]}
              </p>
              <div className="reconfig-detail-status">
                <StatusBadge status={detail.status} label={STATUS_LABELS[detail.status as ReconfigStatus] || detail.status} />
              </div>
            </div>
            <div className="reconfig-action-bar">
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

          <div className="reconfig-compare">
            <h3>This unit’s name</h3>
            <div className="reconfig-compare-grid">
              <div className="reconfig-compare-col">
                <p className="reconfig-compare-heading">Before</p>
                <p className="reconfig-compare-value">{detail.currentSnapshot?.displayName || '—'}</p>
              </div>
              <Fa icon={faArrowRight} className="reconfig-compare-arrow" />
              <div className="reconfig-compare-col is-after">
                <p className="reconfig-compare-heading">After (this unit’s name)</p>
                <p className="reconfig-compare-value">{detail.proposedSnapshot?.displayName || '—'}</p>
              </div>
            </div>
          </div>

          <div className="reconfig-metrics">
            <div className="reconfig-metric">
              <p>Cost</p>
              <div>
                {fmtKes(detail.costBefore)}
                <Fa icon={faArrowRight} className="reconfig-table-arrow" />
                {fmtKes(detail.costAfter)}
              </div>
            </div>
            <div className="reconfig-metric">
              <p>Selling price</p>
              <div>{fmtKes(detail.finalSellingPrice ?? detail.recommendedSellingPrice ?? 0)}</div>
            </div>
            <div className="reconfig-metric">
              <p>Gross margin</p>
              <div>{Number(detail.grossMarginPct || 0).toFixed(1)}%</div>
            </div>
          </div>

          <section className="reconfig-lines">
            <h3>Removed (back to parts)</h3>
            <ul>
              {(detail.removalLines || []).map((l: any) => (
                <li key={l.id}>
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
              {!detail.removalLines?.length && <li className="reconfig-lines-empty">None</li>}
            </ul>
          </section>

          <section className="reconfig-lines">
            <h3>Installed from parts</h3>
            <ul>
              {(detail.installationLines || []).map((l: any) => (
                <li key={l.id}>
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
              {!detail.installationLines?.length && <li className="reconfig-lines-empty">None</li>}
            </ul>
          </section>
        </div>
      )}
      </div>
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
    <fieldset className="reconfig-slot">
      <legend className="reconfig-slot-legend">
        <Fa icon={title.startsWith('RAM') ? faMemory : faHardDrive} />
        {title}
      </legend>
      <p className="reconfig-slot-hint">{hint}</p>
      <div className="reconfig-seg" role="radiogroup" aria-label={`${title} action`}>
        {ACTIONS.map(a => (
          <label
            key={a.value}
            className={`reconfig-seg-item${draft.action === a.value ? ' is-active' : ''}`}
          >
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
            <span>{a.label}</span>
          </label>
        ))}
      </div>

      {draft.action !== 'none' && (
        <label className="reconfig-field">
          <span>How many are fitted now?</span>
          <select
            className="form-select w-full"
            value={draft.moduleCount}
            onChange={e => onChange({ ...draft, moduleCount: Number(e.target.value) })}
          >
            <option value={1}>1</option>
            <option value={2}>2</option>
          </select>
        </label>
      )}

      {needsOut && (
        <SearchablePick
          label="Pulled module becomes this part in stock"
          value={draft.outgoingProductId}
          placeholder={title.startsWith('RAM') ? 'Search RAM module…' : 'Search SSD or HDD…'}
          emptyText={title.startsWith('RAM') ? 'No RAM modules in the catalogue' : 'No SSD/HDD parts in the catalogue'}
          options={parts.map(p => ({
            id: p.id,
            label: `${p.name || 'Part'}${p.sku ? ` (${p.sku})` : ''}`,
          }))}
          onChange={id => onChange({ ...draft, outgoingProductId: id })}
        />
      )}

      {needsIn && (
        <SearchablePick
          label="Fit this part from warehouse"
          value={draft.incomingProductId}
          placeholder={title.startsWith('RAM') ? 'Search RAM module…' : 'Search SSD or HDD…'}
          emptyText={title.startsWith('RAM') ? 'No RAM modules in the catalogue' : 'No SSD/HDD parts in the catalogue'}
          options={parts.map(p => ({
            id: p.id,
            label: `${p.name || 'Part'}${p.sku ? ` (${p.sku})` : ''}`,
          }))}
          onChange={id => onChange({ ...draft, incomingProductId: id })}
        />
      )}
    </fieldset>
  )
}
