'use client'

import React, { useMemo, useState } from 'react'
import { Modal, Field, Input, Select, Textarea } from '@/components/ui'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { Fa } from '@/components/icons'
import { faPrint, faPlus } from '@fortawesome/free-solid-svg-icons'
import { LOCATIONS, LocationId, Product, SerialNumber, useInventoryStore, fmtDate } from '@/lib/store'
import { validateSerialEdit } from '@/lib/inventory/serial-edit'
import { canIntakeOnHandSerials, canReleaseHeldSerial } from '@/lib/inventory/permissions'
import { ON_HAND_LOCATIONS, parseSerialList, type OnHandLocation } from '@/lib/inventory/serial-intake'
import { inferTrackingMethod, isSerialTracking } from '@/lib/inventory-identifiers'

type StatusChip =
  | 'all'
  | 'available'
  | 'assigned'
  | 'sold'
  | 'refurbishment'
  | 'under_repair'
  | 'returned'
  | 'written_off'

interface SerialManageDrawerProps {
  product: Product
  serials: SerialNumber[]
  canEdit: boolean
  warehouseFilter: LocationId | 'all'
  onClose: () => void
  onPrintSerials: (items: Array<{ serial: string; barcode?: string; productName: string; sku: string; category?: string }>) => Promise<void>
  onDownloadSerials: (items: Array<{ serial: string; barcode?: string; productName: string; sku: string; category?: string }>) => Promise<string>
}

export default function SerialManageDrawer({
  product,
  serials,
  canEdit,
  warehouseFilter,
  onClose,
  onPrintSerials,
  onDownloadSerials,
}: SerialManageDrawerProps) {
  const {
    serials: allSerials,
    saleOrders,
    updateSerial,
    releaseSerialToStock,
    intakeProductSerials,
    openingStockPosted,
    addAuditLog,
    showToast,
    users,
    currentUserId,
  } = useInventoryStore()

  const role = users.find(u => u.id === currentUserId)?.role
  const canRelease = canReleaseHeldSerial(role)
  const canIntake = canIntakeOnHandSerials(role)
  const willUpgradeToSerial = !isSerialTracking(inferTrackingMethod(product))

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusChip>('all')
  // Always show customer/sold/employee locations unless user opts into warehouse-only.
  const [locationScope, setLocationScope] = useState<'all_locations' | 'warehouse_filter'>('all_locations')
  const [editTarget, setEditTarget] = useState<SerialNumber | null>(null)
  const [form, setForm] = useState({ serial: '', barcode: '', specs: '', conditionNotes: '', reason: '' })
  const [busy, setBusy] = useState(false)
  const [showIntake, setShowIntake] = useState(false)
  const [intakeRaw, setIntakeRaw] = useState('')
  const [intakeLocation, setIntakeLocation] = useState<OnHandLocation>('warehouse')
  const [intakeReason, setIntakeReason] = useState(
    openingStockPosted ? 'Physical count / found stock' : 'Opening balance — not previously posted',
  )
  const parsedIntake = useMemo(() => parseSerialList(intakeRaw), [intakeRaw])

  const scoped = useMemo(() => {
    if (locationScope === 'all_locations' || warehouseFilter === 'all') return serials
    return serials.filter(s => s.location === warehouseFilter)
  }, [serials, warehouseFilter, locationScope])

  const statusCounts = useMemo(() => {
    const counts: Record<StatusChip, number> = {
      all: scoped.length,
      available: 0,
      assigned: 0,
      sold: 0,
      refurbishment: 0,
      under_repair: 0,
      returned: 0,
      written_off: 0,
    }
    for (const s of scoped) {
      if (s.status === 'available') counts.available++
      else if (s.status === 'assigned') counts.assigned++
      else if (s.status === 'sold') counts.sold++
      else if (s.status === 'refurbishment') counts.refurbishment++
      else if (s.status === 'under_repair') counts.under_repair++
      else if (s.status === 'returned') counts.returned++
      else if (s.status === 'written_off') counts.written_off++
    }
    return counts
  }, [scoped])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return scoped.filter(s => {
      if (statusFilter !== 'all' && s.status !== statusFilter) return false
      if (!q) return true
      return (
        s.serial.toLowerCase().includes(q) ||
        String(s.barcode || '').toLowerCase().includes(q) ||
        String(s.sku || '').toLowerCase().includes(q)
      )
    })
  }, [scoped, search, statusFilter])

  const soRefFor = (serial: SerialNumber) => {
    const list = saleOrders || []
    const so = list.find(o =>
      o.id === serial.saleOrderId ||
      o.lines.some(l => (l.serialIds || []).includes(serial.id)),
    )
    return so?.ref || so?.id
  }

  const openEdit = (serial: SerialNumber) => {
    setEditTarget(serial)
    setForm({
      serial: serial.serial,
      barcode: serial.barcode || '',
      specs: serial.specs || '',
      conditionNotes: serial.accessoryNotes || '',
      reason: '',
    })
  }

  const saveEdit = async () => {
    if (!editTarget || !canEdit) return
    const result = validateSerialEdit({
      current: editTarget,
      next: {
        serial: form.serial,
        barcode: form.barcode,
        specs: form.specs,
        conditionNotes: form.conditionNotes,
      },
      existing: allSerials,
      reason: form.reason,
    })
    if (!result.ok) {
      showToast(result.error, 'error')
      return
    }

    setBusy(true)
    try {
      const res = await fetch(`/api/serials/${editTarget.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serial: result.patch.serial,
          barcode: result.patch.barcode,
          specs: result.patch.specs,
          accessoryNotes: result.patch.conditionNotes,
          reason: form.reason,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        showToast(data.error || 'Failed to update serial', 'error')
        return
      }
      updateSerial(editTarget.id, {
        serial: result.patch.serial,
        barcode: result.patch.barcode,
        specs: result.patch.specs,
        accessoryNotes: result.patch.conditionNotes,
      })
      addAuditLog(
        'serial_edit',
        result.patch.serial,
        `Serial ${editTarget.serial} → ${result.patch.serial} for ${product.name}. Reason: ${form.reason || 'n/a'}`,
      )
      showToast('Serial updated', 'success')
      setEditTarget(null)
    } catch {
      showToast('Failed to update serial', 'error')
    } finally {
      setBusy(false)
    }
  }

  const submitIntake = async () => {
    if (!canIntake) return
    if (parsedIntake.length === 0) {
      showToast('Paste or type at least one serial number', 'error')
      return
    }
    if (!intakeReason.trim()) {
      showToast('Enter a reason for this intake', 'error')
      return
    }
    setBusy(true)
    try {
      const result = await intakeProductSerials(product.id, {
        serials: parsedIntake,
        location: intakeLocation,
        reason: intakeReason.trim(),
        kind: openingStockPosted ? 'stock_intake' : 'opening_balance',
      })
      if (result) {
        setShowIntake(false)
        setIntakeRaw('')
        setStatusFilter('available')
      }
    } finally {
      setBusy(false)
    }
  }

  const columns: ColumnDef<SerialNumber>[] = [
    {
      key: 'serial',
      label: 'Serial number',
      priority: 1,
      width: 'minmax(10rem, 1.4fr)',
      render: row => (
        <div className="min-w-0">
          <div className="text-xs font-bold font-mono text-text-1">{row.serial}</div>
          {row.barcode && row.barcode !== row.serial && (
            <div className="text-[10px] text-text-3 font-mono">Tag: {row.barcode}</div>
          )}
          {soRefFor(row) && (
            <div className="text-[10px] text-primary-700 font-mono mt-0.5">SO: {soRefFor(row)}</div>
          )}
        </div>
      ),
      exportValue: row => row.serial,
    },
    {
      key: 'warehouse',
      label: 'Location',
      priority: 2,
      width: '120px',
      render: row => <span className="text-xs text-text-2">{LOCATIONS[row.location]?.name || row.location}</span>,
      exportValue: row => LOCATIONS[row.location]?.name || row.location,
    },
    {
      key: 'status',
      label: 'Status',
      priority: 2,
      width: '110px',
      render: row => {
        const color =
          row.status === 'available' ? '#166534' :
          row.status === 'assigned' ? '#92400E' :
          row.status === 'sold' ? '#1E3A8A' :
          row.status === 'written_off' ? '#991B1B' :
          '#374151'
        return (
          <span className="text-xs capitalize font-bold" style={{ color }}>
            {row.status.replace(/_/g, ' ')}
          </span>
        )
      },
      exportValue: row => row.status,
    },
    {
      key: 'received',
      label: 'Dates',
      priority: 3,
      width: '120px',
      render: row => (
        <div className="text-[10px] text-text-3">
          <div>In: {row.receivedDate ? fmtDate(row.receivedDate) : '—'}</div>
          {row.soldDate && <div>Sold: {fmtDate(row.soldDate)}</div>}
        </div>
      ),
      exportValue: row => row.soldDate || row.receivedDate || '',
    },
  ]

  const chips: Array<[StatusChip, string]> = [
    ['all', `All (${statusCounts.all})`],
    ['available', `Available (${statusCounts.available})`],
    ['assigned', `Reserved (${statusCounts.assigned})`],
    ['sold', `Sold (${statusCounts.sold})`],
    ['refurbishment', `Refurb (${statusCounts.refurbishment})`],
    ['under_repair', `Under repair (${statusCounts.under_repair})`],
    ['returned', `Returned (${statusCounts.returned})`],
    ['written_off', `Written off (${statusCounts.written_off})`],
  ]

  return (
    <>
      <Modal title={`Serials · ${product.name}`} onClose={onClose} width={980}>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-text-3">
              SKU {product.sku}
              {locationScope === 'warehouse_filter' && warehouseFilter !== 'all'
                ? ` · Filtered to ${LOCATIONS[warehouseFilter].name}`
                : ' · All locations (incl. customer / sold)'}
              {' · '}
              Available {statusCounts.available} · On list {statusCounts.all}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {canIntake && (
                <button
                  type="button"
                  className="btn-primary text-[11px]"
                  onClick={() => setShowIntake(true)}
                  title="Add available on-hand serials (increases quantity)"
                >
                  <Fa icon={faPlus} className="mr-1" /> Add on-hand serials
                </button>
              )}
              {warehouseFilter !== 'all' && (
                <label className="flex items-center gap-2 text-[10px] text-text-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={locationScope === 'warehouse_filter'}
                    onChange={e => setLocationScope(e.target.checked ? 'warehouse_filter' : 'all_locations')}
                  />
                  Limit to selected warehouse only
                </label>
              )}
            </div>
          </div>

          {willUpgradeToSerial && canIntake && (
            <p className="text-[11px] text-blue-900 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
              This product is currently quantity-tracked. Adding on-hand serials will switch it to <strong>SERIAL</strong> unit tracking.
            </p>
          )}

          {statusCounts.available === 0 && canIntake && (
            <p className="text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              No available on-hand units yet.
              {!openingStockPosted
                ? ' Opening stock was never posted — use Add on-hand serials to seed this product without the global opening-stock lock.'
                : ' Use Add on-hand serials for count corrections or units found in the warehouse.'}
            </p>
          )}

          <div className="flex flex-wrap gap-2 text-[10px]">
            {chips.map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setStatusFilter(id)}
                className="px-2.5 py-1 rounded-lg border text-[10px] font-bold cursor-pointer"
                style={{
                  borderColor: statusFilter === id ? '#A8D4E8' : 'var(--border-lt)',
                  background: statusFilter === id ? '#E8F3FA' : 'transparent',
                  color: statusFilter === id ? 'var(--navy)' : 'var(--text-3)',
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {statusCounts.assigned > 0 && (
            <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              {statusCounts.assigned} reserved (assigned) serial(s) are still on hand but not Available.
              Use <strong>Release</strong> to return them to free stock.
            </p>
          )}
          {statusCounts.sold > 0 && statusFilter === 'all' && (
            <p className="text-[11px] text-blue-900 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
              {statusCounts.sold} sold serial(s) are with customers — open the <strong>Sold</strong> filter to list them.
              They do not count in On hand / Available.
            </p>
          )}

          <DataTable
            tableId={`inventory-serials-${product.id}`}
            columns={columns}
            rows={rows}
            rowKey={r => r.id}
            searchValue={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search serial, asset tag, or SKU…"
            clientSearch={false}
            hideColumnFilters
            selectable
            perPage={15}
            emptyMessage={
              statusFilter === 'sold'
                ? 'No sold serials for this product'
                : statusFilter === 'assigned'
                  ? 'No reserved serials for this product'
                  : canIntake
                    ? 'No serials yet — use Add on-hand serials to increase quantity'
                    : 'No serials match this filter'
            }
            exportTitle={`${product.sku}-serials`}
            exportFilename={`${product.sku}-serials`}
            bulkActions={({ rows: selected, clear }) => (
              <div className="flex flex-wrap gap-2 items-center">
                <span className="text-xs font-bold">{selected.length} selected</span>
                {canRelease && selected.some(s => s.status === 'assigned' || s.status === 'returned') && (
                  <button
                    type="button"
                    className="dt-toolbar-btn"
                    onClick={() => {
                      selected
                        .filter(s => s.status === 'assigned' || s.status === 'returned')
                        .forEach(s => releaseSerialToStock(s.id, 'warehouse'))
                      clear()
                    }}
                  >
                    Release to on hand
                  </button>
                )}
                <button
                  type="button"
                  className="dt-toolbar-btn"
                  onClick={() => {
                    void onPrintSerials(selected.map(s => ({
                      serial: s.serial,
                      barcode: s.barcode,
                      productName: product.name,
                      sku: product.sku,
                      category: product.category,
                    })))
                  }}
                >
                  <Fa icon={faPrint} className="dt-toolbar-icon" /> Print labels
                </button>
                <button
                  type="button"
                  className="dt-toolbar-btn"
                  onClick={() => {
                    void onDownloadSerials(selected.map(s => ({
                      serial: s.serial,
                      barcode: s.barcode,
                      productName: product.name,
                      sku: product.sku,
                      category: product.category,
                    })))
                  }}
                >
                  Download PDF
                </button>
                <button type="button" className="dt-toolbar-btn" onClick={clear}>Clear</button>
              </div>
            )}
            rowActions={row => (
              <div className="flex gap-1 justify-end flex-wrap">
                {(row.status === 'assigned' || row.status === 'returned') && canRelease && (
                  <button
                    type="button"
                    className="px-2 py-1 rounded-lg border text-[10px] font-bold text-amber-800 border-amber-300 bg-amber-50"
                    onClick={() => releaseSerialToStock(row.id, 'warehouse')}
                  >
                    Release
                  </button>
                )}
                <button
                  type="button"
                  className="px-2 py-1 rounded-lg border text-[10px] font-bold"
                  onClick={() => {
                    void onPrintSerials([{
                      serial: row.serial,
                      barcode: row.barcode,
                      productName: product.name,
                      sku: product.sku,
                      category: product.category,
                    }])
                  }}
                >
                  Label
                </button>
                {canEdit && (
                  <button
                    type="button"
                    className="px-2 py-1 rounded-lg border text-[10px] font-bold text-primary-700"
                    onClick={() => openEdit(row)}
                  >
                    Edit
                  </button>
                )}
              </div>
            )}
          />
        </div>
      </Modal>

      {editTarget && (
        <Modal title={`Edit serial · ${editTarget.serial}`} onClose={() => setEditTarget(null)} width={480}>
          <div className="flex flex-col gap-3">
            <Field label="Serial number" required>
              <Input value={form.serial} onChange={v => setForm(f => ({ ...f, serial: v }))} />
            </Field>
            <Field label="Asset tag / barcode">
              <Input value={form.barcode} onChange={v => setForm(f => ({ ...f, barcode: v }))} />
            </Field>
            <Field label="Specs">
              <Input value={form.specs} onChange={v => setForm(f => ({ ...f, specs: v }))} />
            </Field>
            <Field label="Condition notes">
              <Input value={form.conditionNotes} onChange={v => setForm(f => ({ ...f, conditionNotes: v }))} />
            </Field>
            <Field label="Reason for edit" required>
              <Input value={form.reason} onChange={v => setForm(f => ({ ...f, reason: v }))} />
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <button className="btn-secondary text-[11px]" onClick={() => setEditTarget(null)} disabled={busy}>Cancel</button>
              <button className="btn-primary text-[11px]" onClick={saveEdit} disabled={busy}>
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {showIntake && (
        <Modal title={`Add on-hand serials · ${product.name}`} onClose={() => !busy && setShowIntake(false)} width={560}>
          <div className="flex flex-col gap-3">
            <p className="text-[11px] text-text-3 leading-relaxed">
              Each serial becomes one <strong>available</strong> on-hand unit and increases product quantity.
              Duplicates (already in the system or repeated in this list) are rejected.
              {!openingStockPosted
                ? ' This is recorded as an opening balance for this product only — it does not lock global Opening Stock.'
                : ' This is recorded as a stock intake / count correction with an INTK document ref.'}
            </p>
            <Field label="Location" required>
              <Select
                value={intakeLocation}
                onChange={v => setIntakeLocation(v as OnHandLocation)}
                options={ON_HAND_LOCATIONS.map(loc => ({ value: loc, label: LOCATIONS[loc]?.name || loc }))}
              />
            </Field>
            <Field label="Serial numbers (one per line, or comma-separated)" required>
              <Textarea
                value={intakeRaw}
                onChange={v => setIntakeRaw(v)}
                rows={8}
                placeholder={'LR0AWKL5\nPF1A2B3C\n…'}
              />
            </Field>
            <p className="text-[11px] font-bold" style={{ color: parsedIntake.length ? 'var(--success)' : 'var(--text-3)' }}>
              {parsedIntake.length} unique serial{parsedIntake.length === 1 ? '' : 's'} ready to add
            </p>
            <Field label="Reason" required>
              <Input
                value={intakeReason}
                onChange={v => setIntakeReason(v)}
                placeholder="Opening balance / physical count / found stock"
              />
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <button className="btn-secondary text-[11px]" onClick={() => setShowIntake(false)} disabled={busy}>Cancel</button>
              <button
                className="btn-primary text-[11px]"
                onClick={() => { void submitIntake() }}
                disabled={busy || parsedIntake.length === 0 || !intakeReason.trim()}
              >
                {busy ? 'Adding…' : `Add ${parsedIntake.length || ''} unit${parsedIntake.length === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
