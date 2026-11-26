'use client'

/**
 * Device reconfiguration — bench flow.
 *
 * RAM and SSD use the same four moves: leave / pull one / swap / add.
 * Apply now creates the work order, moves parts stock, and rewrites this
 * unit's selling name (serial.specs). The catalog SKU name is not changed.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ModuleHeader, TabBar, PanelHeader } from '@/components/ui'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { PrimaryActionButton, StatusBadge } from '@/components/erp'
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
import { compactSpecsString, UNIT_CONFIG_SOURCE_LABEL, type UnitConfigSource } from '@/lib/reconfiguration/unit-config'
import SearchablePick from '@/components/reconfiguration/SearchablePick'
import { canFinishStuckBenchJob, readBenchNotes } from '@/lib/reconfiguration/bench-notes'
import { useUrlQueryState, useUrlRecordId, useUrlUiState } from '@/hooks/useUrlRecordId'
import { userCan } from '@/lib/auth/can'

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
  notes?: string | null
  dateCompleted?: string | null
  removalLines?: { actualRemovedAt?: string | null; qaStatus?: string | null }[]
}

/** Parts pulled in a finished job and not yet tested. */
const untestedParts = (o: { status: string; removalLines?: { actualRemovedAt?: string | null; qaStatus?: string | null }[] }) =>
  o.status === 'completed' ? (o.removalLines ?? []).filter(l => l.actualRemovedAt && (l.qaStatus ?? 'pending') === 'pending').length : 0
/** A bench job is done in one press; still "in progress" means it stopped half-way. */
const isStuckBench = (o: { status: string; notes?: string | null }) => o.status === 'in_progress' && !!readBenchNotes(o.notes)

type SlotDraft = {
  action: BenchActionKind
  /** '' until the user (or the device's own installed config) says how many are fitted. */
  moduleCount: number | ''
  outgoingProductId: string
  incomingProductId: string
}

function listNextAction(o: WorkOrderListItem): string {
  if (isStuckBench(o)) return 'Stopped half-way — open it: Finish or Undo'
  const untested = untestedParts(o)
  if (untested > 0) return `Test ${untested} pulled part${untested === 1 ? '' : 's'}`
  return String(reconfigurationNextAction(o.status) ?? '')
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


const ACTIONS: Array<{ value: BenchActionKind; label: string }> = [
  { value: 'none', label: 'Leave as-is' },
  { value: 'pull_one', label: 'Pull one' },
  { value: 'swap', label: 'Swap' },
  { value: 'add_one', label: 'Add one' },
]

function emptySlot(): SlotDraft {
  return { action: 'none', moduleCount: '', outgoingProductId: '', incomingProductId: '' }
}

/** Module count sent to the bench engine; pull_one always needs at least two fitted. */
function slotModuleCount(slot: SlotDraft): number {
  const n = Number(slot.moduleCount) || 0
  return slot.action === 'pull_one' ? Math.max(2, n) : n
}

function slotNeedsModuleCount(slot: SlotDraft): boolean {
  return slot.action !== 'none' && slot.moduleCount === ''
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
  const { currentUserId, users, serials, products, systemSettings, updateSerial } = useOperationsStore()
  const currentUser = users.find(u => u.id === currentUserId)
  const role = currentUser?.role ?? ''

  const [tabValue, setTabValue] = useUrlQueryState('tab', 'orders')
  const [recordId, setRecordId] = useUrlRecordId()
  const [orders, setOrders] = useState<WorkOrderListItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<any>(null)
  /** The bench job's saved notes (stuck reason, reversal), when the open job is one. */
  const detailBench = detail ? readBenchNotes(detail.notes) : null
  const tab: 'orders' | 'new' | 'detail' =
    tabValue === 'new' ? 'new' : tabValue === 'detail' && detail ? 'detail' : 'orders'
  const setTab = useCallback((next: 'orders' | 'new' | 'detail') => {
    if (next !== 'detail' && recordId) {
      setRecordId(null, { queryPatch: { tab: next } })
      if (next === 'orders') setDetail(null)
      return
    }
    setTabValue(next)
  }, [recordId, setRecordId, setTabValue])

  const [statusFilter, setStatusFilter] = useUrlUiState('status', '')
  const [q, setQ] = useUrlUiState('q', '')

  const [wizSerialId, setWizSerialId] = useState('')
  const [deviceConfig, setDeviceConfig] = useState<any>(null)
  const [ram, setRam] = useState<SlotDraft>(emptySlot)
  const [storage, setStorage] = useState<SlotDraft>(emptySlot)
  const [price, setPrice] = useState('')
  const [labour, setLabour] = useState('')
  const [jobReason, setJobReason] = useState('')
  const [reverseReason, setReverseReason] = useState('')
  const [reversing, setReversing] = useState(false)
  const [doneHint, setDoneHint] = useState<string | null>(null)
  const [manualRamGb, setManualRamGb] = useState('')
  const [manualStorageGb, setManualStorageGb] = useState('')

  const canCreate = userCan({ role }, 'createReconfiguration')
  const canReverse = userCan({ role }, 'reverseReconfiguration')
  const canTestParts = userCan({ role }, 'completeReconfiguration')
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

  // Reconfiguration is completed server-side. Mirror that authoritative
  // snapshot into the in-memory serial store immediately so Inventory, Sales
  // and POS do not keep rendering the pre-upgrade RAM/SSD until an SSE event
  // or full page reload arrives.
  const syncCompletedUnitToClient = useCallback((
    cfg: any,
    workOrder?: any,
    requestedSerialId?: string,
  ) => {
    if (!cfg?.current) return
    const row = (serials || []).find((s: any) =>
      s.id === cfg.blobSerialId
      || s.id === cfg.serialId
      || s.id === requestedSerialId
      || s.serial === cfg.manufacturerSerial,
    )
    if (!row) return

    const specs = compactSpecsString(cfg.current)
    const finalPrice = Number(workOrder?.finalSellingPrice)
    const patch: Record<string, unknown> = {}

    if (specs && specs !== row.specs) patch.specs = specs
    if (cfg.status && cfg.status !== row.status) patch.status = cfg.status
    if (cfg.location && cfg.location !== row.location) patch.location = cfg.location
    if (Number.isFinite(finalPrice) && finalPrice >= 0 && finalPrice !== Number(row.salePriceOverride)) {
      patch.salePriceOverride = finalPrice
    }

    if (Object.keys(patch).length > 0) {
      updateSerial(row.id, patch as any, { persist: false })
    }
  }, [serials, updateSerial])

  const refreshCompletedUnit = useCallback(async (
    serialId: string,
    workOrder?: any,
  ) => {
    const cfg = await api<any>(
      `/api/reconfiguration/device/${encodeURIComponent(serialId)}/configuration`,
    )
    setDeviceConfig(cfg)
    syncCompletedUnitToClient(cfg, workOrder, serialId)
    return cfg
  }, [syncCompletedUnitToClient])

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

  const loadDetail = useCallback(async (id: string, opts?: { fromUrl?: boolean }) => {
    setLoading(true)
    setError(null)
    try {
      const data = await api<any>(`/api/reconfiguration/${id}`)
      setDetail(data)
      if (opts?.fromUrl) {
        setRecordId(id, { localOnly: true })
        if (tabValue !== 'detail') setTabValue('detail', { history: 'replace' })
      } else {
        setRecordId(id, { queryPatch: { tab: 'detail' } })
      }
    } catch (e: any) {
      setError(e.message || 'Failed to load work order')
      if (opts?.fromUrl) {
        setRecordId(null, { queryPatch: { tab: 'orders' }, history: 'replace' })
      }
    } finally {
      setLoading(false)
    }
  }, [setRecordId, setTabValue, tabValue])

  useEffect(() => {
    if (!enabled || !recordId) return
    if (detail?.id === recordId) return
    void loadDetail(recordId, { fromUrl: true })
  }, [enabled, recordId, detail?.id, loadDetail])

  useEffect(() => {
    if (enabled && !recordId && tab === 'orders') void loadOrders()
  }, [enabled, recordId, tab, loadOrders])

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
      const cfg = await refreshCompletedUnit(serialId)
      const ramCount = (cfg?.installed || []).filter(
        (i: any) => i.category === 'ram' || i.slotType === 'ram_slot',
      ).length
      const ssdCount = (cfg?.installed || []).filter(
        (i: any) => i.category === 'storage' || i.slotType === 'm2_slot' || i.slotType === 'sata_bay',
      ).length
      // Device-derived counts are real data; when the device reports none the
      // user must say how many are fitted.
      setRam({ ...emptySlot(), moduleCount: ramCount || '' })
      setStorage({ ...emptySlot(), moduleCount: ssdCount || '' })
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
    if (slotNeedsModuleCount(ram) || slotNeedsModuleCount(storage)) return null
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
        moduleCount: slotModuleCount(ram),
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
        moduleCount: slotModuleCount(storage),
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
    if (slotNeedsModuleCount(ram)) return 'Select how many RAM modules are fitted now.'
    if (slotNeedsModuleCount(storage)) return 'Select how many SSD/HDD drives are fitted now.'
    if (!preview) return 'Choose a RAM or SSD action.'
    if (preview.error) return preview.error
    if (unresolved && ram.action !== 'none' && !currentRamGb) {
      return 'Enter the current RAM size in GB so the new total can be calculated.'
    }
    if (unresolved && storage.action !== 'none' && !currentStorageGb) {
      return 'Enter the current SSD size in GB so the new total can be calculated.'
    }
    return null
  }, [deviceConfig, preview, unresolved, ram, storage, currentRamGb, currentStorageGb])

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
            moduleCount: slotModuleCount(ram) || undefined,
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
            moduleCount: slotModuleCount(storage) || undefined,
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
          labourCost: labour.trim() ? Number(labour) : undefined,
          reason: jobReason.trim() || undefined,
        }),
      })
      setDetail(wo)

      // Do not leave the client on the old unit specs after a successful
      // server-side reconfiguration. Re-read the promoted snapshot and mirror
      // it locally before the user returns to Inventory / Sales / POS.
      try {
        await refreshCompletedUnit(wizSerialId, wo)
      } catch {
        // The work order is already complete; SSE remains a fallback refresh.
      }

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
      // The machine's specs or price changed: mirror them here at once.
      if (['complete', 'finish', 'reverse', 'undo'].includes(path) && ['completed', 'reversed', 'cancelled'].includes(data?.status)) {
        const serialKey = data.serialId || data.manufacturerSerial
        if (serialKey) {
          try {
            await refreshCompletedUnit(serialKey, data.status === 'completed' ? data : { finalSellingPrice: data.sellingPriceBefore })
          } catch {
            // Completion succeeded; SSE / the next device load can still refresh.
          }
        }
      }
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

  const stuckCount = orders.filter(isStuckBench).length
  const partsToTest = orders.reduce((sum, o) => sum + untestedParts(o), 0)
  const weekStartDay = new Date(Date.now() - ((new Date().getDay() + 6) % 7) * 86400000).toISOString().slice(0, 10)
  const olderOpen = orders.filter(o => !['completed', 'cancelled', 'reversed'].includes(o.status) && !isStuckBench(o)).length

  const orderColumns: ColumnDef<WorkOrderListItem>[] = [
    { key: 'ref', label: 'Ref', priority: 1, width: '110px', render: o => <span className="text-xs font-bold text-[var(--text-1)]">{o.ref}</span>, accessor: o => o.ref, exportValue: o => o.ref },
    { key: 'serial', label: 'Serial', priority: 2, width: '1fr', render: o => <span className="font-mono text-[11px] text-[var(--text-2)]">{o.manufacturerSerial}</span>, accessor: o => o.manufacturerSerial, exportValue: o => o.manufacturerSerial },
    {
      key: 'device', label: 'Device / type', priority: 1, width: '1.5fr',
      render: o => (
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-[var(--text-1)]">{o.product?.name || o.currentSnapshot?.displayName || 'Serialized device'}</p>
          <p className="mt-0.5 text-[11px] text-[var(--text-3)]">{TRANSACTION_TYPE_LABELS[o.transactionType] || o.transactionType}</p>
        </div>
      ),
      accessor: o => `${o.product?.name || o.currentSnapshot?.displayName || ''} ${o.transactionType}`,
      exportValue: o => o.product?.name || o.currentSnapshot?.displayName || 'Serialized device',
    },
    { key: 'status', label: 'Status', priority: 1, width: '140px', render: o => <StatusBadge status={o.status} label={STATUS_LABELS[o.status] || o.status} />, accessor: o => STATUS_LABELS[o.status] || o.status, exportValue: o => STATUS_LABELS[o.status] || o.status },
    {
      key: 'config', label: 'Change', priority: 2, width: '1.2fr', sortable: false,
      render: o => (
        <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--text-2)]">
          {o.currentSnapshot?.totalRamGb ?? '—'}GB/{o.currentSnapshot?.primaryStorageGb ?? '—'}GB
          <Fa icon={faArrowRight} className="text-[10px] text-[var(--text-4)]" />
          {o.proposedSnapshot?.totalRamGb ?? '—'}GB/{o.proposedSnapshot?.primaryStorageGb ?? '—'}GB
        </span>
      ),
      exportValue: o => `${o.currentSnapshot?.totalRamGb ?? '-'}GB/${o.currentSnapshot?.primaryStorageGb ?? '-'}GB -> ${o.proposedSnapshot?.totalRamGb ?? '-'}GB/${o.proposedSnapshot?.primaryStorageGb ?? '-'}GB`,
    },
    {
      key: 'cost', label: 'Cost', priority: 2, width: '170px', align: 'right',
      render: o => (
        <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--text-2)]">
          {fmtKes(o.costBefore)}
          <Fa icon={faArrowRight} className="text-[10px] text-[var(--text-4)]" />
          {fmtKes(o.costAfter)}
        </span>
      ),
      sortValue: o => o.costAfter,
      exportValue: o => `${o.costBefore} -> ${o.costAfter}`,
    },
    { key: 'next', label: 'Next action', priority: 3, width: '1.2fr', render: o => <span className="text-[11px] text-[var(--text-3)]">{listNextAction(o)}</span>, sortable: false, exportValue: o => listNextAction(o) },
  ]

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
        {/* Bench jobs finish in one press: what needs a person is a job that
            stopped half-way, and parts pulled out that nobody has tested. */}
        <button type="button" className={stuckCount > 0 ? 'is-alert' : ''} onClick={() => { setTab('orders'); setStatusFilter('in_progress') }}>
          <span>Stuck</span>
          <strong>{stuckCount}</strong>
          <small>Stopped half-way: Finish or Undo</small>
        </button>
        <button type="button" onClick={() => { setTab('orders'); setStatusFilter('completed') }}>
          <span>Parts to test</span>
          <strong>{partsToTest}</strong>
          <small>Pulled out, not yet passed or failed</small>
        </button>
        <button type="button" onClick={() => { setTab('orders'); setStatusFilter('completed') }}>
          <span>Done this week</span>
          <strong>{orders.filter(o => o.status === 'completed' && String(o.dateCompleted ?? '').slice(0, 10) >= weekStartDay).length}</strong>
          <small>Machines changed since Monday</small>
        </button>
        <button type="button" onClick={() => { setTab('orders'); setStatusFilter('') }}>
          <span>All jobs</span>
          <strong>{orders.length}</strong>
          <small>{olderOpen > 0 ? `${olderOpen} older job${olderOpen === 1 ? '' : 's'} still open` : 'Completed, undone and reversed'}</small>
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
        <div className="card overflow-hidden">
          <PanelHeader title="Work orders" count={orders.length}>
            <select aria-label="Filter by status" className="form-select text-[11px] py-1.5" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="">All statuses</option>
              {Object.entries(STATUS_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <button type="button" className="btn-outline text-[11px] py-1.5 px-3" onClick={() => void loadOrders()} disabled={loading}>
              Refresh
            </button>
          </PanelHeader>
          <DataTable
            tableId="reconfiguration-orders"
            columns={orderColumns}
            rows={orders}
            rowKey={o => o.id}
            // The search lives in the table's toolbar beside its menu (it sat
            // in the panel header, leaving the menu alone on its own row).
            // The server does the matching, so the table does not filter again.
            searchValue={q}
            onSearchChange={setQ}
            clientSearch={false}
            searchPlaceholder="Search ref or serial…"
            onRowClick={o => void loadDetail(o.id)}
            emptyMessage={loading ? 'Loading work orders…' : 'No reconfiguration work orders yet.'}
            exportTitle="Reconfiguration work orders"
            exportFilename="reconfiguration-orders"
          />
        </div>
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
                placeholder="Blank = current price + cost of parts added (never below cost)"
              />
            </label>
          )}
          {deviceConfig && (
            <div className="reconfig-manual-grid">
              <label className="reconfig-field">
                <span>Labour cost (optional)</span>
                <input type="number" className="form-input w-full" min={0} value={labour}
                  onChange={e => setLabour(e.target.value)} placeholder="Added to this unit's cost" />
              </label>
              <label className="reconfig-field">
                <span>Reason (optional)</span>
                <input className="form-input w-full" value={jobReason} maxLength={200}
                  onChange={e => setJobReason(e.target.value)} placeholder="e.g. Customer asked for 16GB" />
              </label>
            </div>
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
              {detailBench && detail.status === 'in_progress' ? (
                <>
                  {canCreate && canFinishStuckBenchJob(detail.notes) && (
                    <button type="button" className="btn-primary" onClick={() => void runAction('finish')} disabled={loading}>Finish</button>
                  )}
                  {canCreate && (
                    <button type="button" className="btn-secondary" onClick={() => {
                      if (window.confirm('Put back every part this job moved and cancel it?')) void runAction('undo', {})
                    }} disabled={loading}>Undo</button>
                  )}
                </>
              ) : (
                <>
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
                </>
              )}
              {detail.status === 'completed' && canReverse && !reversing && (
                <button type="button" className="btn-secondary" onClick={() => { setReversing(true); setReverseReason('') }} disabled={loading}>Reverse</button>
              )}
            </div>
          </div>

          {detailBench?.stuck && detail.status === 'in_progress' && (
            <div className="reconfig-banner reconfig-banner--danger" role="alert">
              This job stopped half-way: {detailBench.stuck.message}.{' '}
              {canFinishStuckBenchJob(detail.notes)
                ? 'Fix the cause (for example, receive the missing part), then press Finish — or Undo to put the parts back.'
                : 'It was started before jobs could be resumed: press Undo to put its parts back, then do the job again.'}
            </div>
          )}
          {detailBench && detail.status === 'in_progress' && !detailBench.stuck && (
            <div className="reconfig-banner reconfig-banner--danger" role="alert">
              This bench job did not finish. {canFinishStuckBenchJob(detail.notes) ? 'Press Finish to complete it, or Undo to put the parts back.' : 'Press Undo to put its parts back, then do the job again.'}
            </div>
          )}
          {detail.status === 'reversed' && (
            <div className="reconfig-banner" role="status">
              Reversed{detailBench?.reversed ? `: ${detailBench.reversed.reason}` : ''}. The parts went back and the machine is on its old specs, cost and price.
            </div>
          )}
          {reversing && detail.status === 'completed' && (
            <div className="reconfig-reverse">
              <p>Reversing puts the fitted parts back on the shelf, puts the pulled parts back in the machine, and returns the machine to its old specs, cost and price. Reprint its label afterwards.</p>
              <label className="reconfig-field">
                <span>Why *</span>
                <input className="form-input w-full" value={reverseReason} maxLength={300}
                  onChange={e => setReverseReason(e.target.value)} placeholder="e.g. Wrong RAM fitted" />
              </label>
              <div className="reconfig-reverse__actions">
                <button type="button" className="btn-outline" onClick={() => setReversing(false)}>Keep the job</button>
                <button type="button" className="btn-primary" disabled={!reverseReason.trim() || loading}
                  onClick={() => void runAction('reverse', { reason: reverseReason.trim() }).then(() => setReversing(false))}>Reverse job</button>
              </div>
            </div>
          )}

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
                    {l.actualRemovedAt
                      ? l.qaStatus === 'passed' ? ' — tested good, on the shelf'
                        : l.qaStatus === 'failed' ? ' — faulty, in quarantine'
                        : detail.status === 'completed' ? ' — waiting to be tested' : ' — pulled'
                      : ''}
                  </span>
                  {detail.status === 'completed' && l.actualRemovedAt && (l.qaStatus ?? 'pending') === 'pending' && canTestParts && (
                    <span className="reconfig-test-actions">
                      <button type="button" className="btn-secondary" disabled={loading} onClick={() => void runAction('test-part', { lineId: l.id, passed: true })}>Tested good</button>
                      <button type="button" className="btn-outline" disabled={loading} onClick={() => void runAction('test-part', { lineId: l.id, passed: false })}>Faulty</button>
                    </span>
                  )}
                  {!detailBench && detail.status === 'in_progress' && !l.actualRemovedAt && (
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
                  {!detailBench && detail.status === 'in_progress' && !l.installedAt && (
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
                  moduleCount: a.value === 'pull_one' && draft.moduleCount !== '' ? Math.max(2, draft.moduleCount) : draft.moduleCount,
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
            onChange={e => onChange({ ...draft, moduleCount: e.target.value === '' ? '' : Number(e.target.value) })}
          >
            <option value="">Select…</option>
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
