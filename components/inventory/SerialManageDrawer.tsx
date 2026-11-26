'use client'

import React, { useMemo, useState } from 'react'
import { Modal, Field, Input, Select, Textarea } from '@/components/ui'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { Fa } from '@/components/icons'
import { faPrint, faPlus } from '@fortawesome/free-solid-svg-icons'
import { LOCATIONS, LocationId, Product, SerialNumber, useInventoryStore, fmtDate } from '@/lib/store'
import { validateSerialEdit } from '@/lib/inventory/serial-edit'
import { unitMoveBlocker } from '@/lib/inventory/unit-product-move'
import { MoveSerialProductModal } from './MoveSerialProductModal'
import { canIntakeOnHandSerials, canReleaseHeldSerial } from '@/lib/inventory/permissions'
import { ON_HAND_LOCATIONS, parseSerialList, type OnHandLocation } from '@/lib/inventory/serial-intake'
import { inferTrackingMethod, isSerialTracking } from '@/lib/inventory-identifiers'
import { userCan } from '@/lib/auth/can'
import { SecondaryActionMenu } from '@/components/erp/SecondaryActionMenu'

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
    products,
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
  const [moveTarget, setMoveTarget] = useState<SerialNumber | null>(null)
  const canRelease = canReleaseHeldSerial(role)
  const canIntake = canIntakeOnHandSerials(role)
  // Deleting units from the system is the Director's (inventory.serials.delete).
  const canDelete = userCan(users.find(u => u.id === currentUserId), 'inventory.serials.delete')
  const [deleteTarget, setDeleteTarget] = useState<{ rows: SerialNumber[]; clear: () => void } | null>(null)
  const [deleteReason, setDeleteReason] = useState('')
  const [deleting, setDeleting] = useState(false)
  const runDelete = async () => {
    if (!deleteTarget) return
    if (!deleteReason.trim()) { showToast('Say why these units are being deleted', 'error'); return }
    setDeleting(true)
    try {
      const res = await fetch('/api/inventory/serials-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serialIds: deleteTarget.rows.map(r => r.id), reason: deleteReason.trim() }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || 'Could not delete the units')
      const gone = (body.deleted ?? []).length
      const refused = (body.refused ?? []) as Array<{ serial: string; why: string }>
      showToast(
        `${gone} unit${gone === 1 ? '' : 's'} deleted (${body.reference})`
          + (body.jobsRemoved ? ` · ${body.jobsRemoved} refurbishment job${body.jobsRemoved === 1 ? '' : 's'} removed` : '')
          + (refused.length ? ` · ${refused.length} kept: ${refused.slice(0, 2).map(r => `${r.serial} — ${r.why}`).join('; ')}${refused.length > 2 ? '…' : ''}` : ''),
        refused.length ? 'info' : 'success',
      )
      deleteTarget.clear()
      setDeleteTarget(null)
      setDeleteReason('')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not delete the units', 'error')
    } finally {
      setDeleting(false)
    }
  }
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
  const [intakeLocation, setIntakeLocation] = useState<OnHandLocation | ''>('')
  const [intakeReason, setIntakeReason] = useState('')
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
    if (!intakeLocation) {
      showToast('Select a location for this intake', 'error')
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
        setIntakeLocation('')
        setIntakeReason('')
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
      priority: 1,
      width: '120px',
      render: row => <span className="text-xs text-text-2">{LOCATIONS[row.location]?.name || row.location}</span>,
      exportValue: row => LOCATIONS[row.location]?.name || row.location,
    },
    {
      key: 'status',
      label: 'Status',
      priority: 1,
      width: '110px',
      render: row => <SerialStatusPill status={row.status} />,
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

  // Move stays a visible button: it is the everyday fix for a machine filed
  // under the wrong model. Label, Edit and Release sit in the "⋯".
  const rowMenu = (row: SerialNumber) => (
    <span className="inline-flex items-center gap-1.5">
      {canEdit && !unitMoveBlocker(row) && (
        <button
          type="button"
          className="px-2 py-1 rounded-lg border border-border-lt text-[10px] font-bold text-text-2 hover:bg-surface"
          title="Filed under the wrong model or specs? Move it to the right product"
          aria-label={`Move ${row.serial} to another product`}
          onClick={() => setMoveTarget(row)}
        >
          Move
        </button>
      )}
    <SecondaryActionMenu
      compact
      ariaLabel={`Actions for ${row.serial}`}
      actions={[
        {
          id: 'release',
          label: 'Release to on hand',
          hidden: !((row.status === 'assigned' || row.status === 'returned') && canRelease),
          onClick: () => releaseSerialToStock(row.id, 'warehouse'),
        },
        {
          id: 'label',
          label: 'Print label',
          onClick: () => {
            void onPrintSerials([{ serial: row.serial, barcode: row.barcode, productName: product.name, sku: product.sku, category: product.category }])
          },
        },
        { id: 'edit', label: 'Edit serial', hidden: !canEdit, onClick: () => openEdit(row) },
      ]}
    />
    </span>
  )

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
      <Modal
        title={product.name}
        subtitle={`${product.sku} · ${statusCounts.available} available of ${statusCounts.all}${locationScope === 'warehouse_filter' && warehouseFilter !== 'all' ? ` · ${LOCATIONS[warehouseFilter].name} only` : ''}`}
        onClose={onClose}
        width={980}
      >
        <div className="serial-drawer space-y-3">
          <div className="serial-drawer__bar flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              {canIntake && (
                <button
                  type="button"
                  className="serial-drawer__add"
                  onClick={() => setShowIntake(true)}
                  title="Add available on-hand serials (increases quantity)"
                >
                  <Fa icon={faPlus} aria-hidden="true" /> Add serials
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
            <p className="serial-drawer__notice text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              No available on-hand units yet.
              {!openingStockPosted
                ? ' Opening stock was never posted — use Add on-hand serials to seed this product without the global opening-stock lock.'
                : ' Use Add on-hand serials for count corrections or units found in the warehouse.'}
            </p>
          )}

          <div className="serial-drawer__chips flex flex-wrap gap-2">
            {/* Only filters with units in them: eight chips, mostly "(0)", took three rows on a phone. */}
            {chips.filter(([id]) => id === 'all' || id === statusFilter || (statusCounts as Record<string, number>)[id] > 0).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setStatusFilter(id)}
                className={`serial-chip${statusFilter === id ? ' is-active' : ''}`}
                aria-pressed={statusFilter === id}
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
            <p className="serial-drawer__notice serial-drawer__notice--sold text-[11px] text-blue-900 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
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
                {/* The table's bar already says how many are selected and has Clear. */}
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
                  PDF
                </button>
                {canDelete && (
                  <button
                    type="button"
                    className="dt-toolbar-btn is-danger"
                    onClick={() => { setDeleteReason(''); setDeleteTarget({ rows: selected, clear }) }}
                  >
                    Delete
                  </button>
                )}
              </div>
            )}
            rowActions={row => rowMenu(row)}
            renderCard={row => (
              <div className="serial-row">
                <div className="min-w-0 flex-1">
                  <p className="serial-row__serial">{row.serial}</p>
                  <p className="serial-row__meta">
                    {LOCATIONS[row.location]?.name || row.location}
                    {row.barcode && row.barcode !== row.serial ? ` · ${row.barcode}` : ''}
                    {soRefFor(row) ? ` · ${soRefFor(row)}` : ''}
                  </p>
                </div>
                <SerialStatusPill status={row.status} />
                {rowMenu(row)}
              </div>
            )}
          />
        </div>
      </Modal>

      {deleteTarget && (
        <Modal
          title={`Delete ${deleteTarget.rows.length} unit${deleteTarget.rows.length === 1 ? '' : 's'} from the system`}
          subtitle="Gone from inventory, With Issues and refurbishment. This cannot be undone."
          onClose={() => setDeleteTarget(null)}
          width={520}
        >
          <div className="flex flex-col gap-3">
            <p className="text-[13px] text-[var(--text-2)]">
              {deleteTarget.rows.slice(0, 6).map(r => r.serial).join(', ')}{deleteTarget.rows.length > 6 ? ` and ${deleteTarget.rows.length - 6} more` : ''}
            </p>
            <p className="text-[12px] text-[var(--text-3)]">
              Units on a sale, invoice, delivery, purchase receipt, POS sale, Kilimall order, warranty or repair are kept and listed —
              that history stays. A received unit that is missing or broken is written off instead.
            </p>
            <Field label="Why they are being deleted" required>
              <Textarea value={deleteReason} onChange={setDeleteReason} rows={2} placeholder="e.g. Entered twice by mistake; test records" />
            </Field>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-outline" onClick={() => setDeleteTarget(null)}>Cancel</button>
              <button
                type="button"
                className="btn-primary disabled:opacity-40"
                style={{ background: 'var(--danger-text)', borderColor: 'var(--danger-text)' }}
                disabled={deleting || !deleteReason.trim()}
                onClick={() => { void runDelete() }}
              >
                {deleting ? 'Deleting…' : 'Delete permanently'}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {moveTarget && (
        <MoveSerialProductModal
          unit={moveTarget}
          products={products}
          showToast={showToast}
          onClose={() => setMoveTarget(null)}
          onMoved={() => setMoveTarget(null)}
        />
      )}

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
                onChange={v => setIntakeLocation(v as OnHandLocation | '')}
                options={[{ value: '', label: 'Select…' }, ...ON_HAND_LOCATIONS.map(loc => ({ value: loc, label: LOCATIONS[loc]?.name || loc }))]}
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
                placeholder={openingStockPosted ? 'e.g. Physical count / found stock' : 'e.g. Opening balance — not previously posted'}
              />
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <button className="btn-secondary text-[11px]" onClick={() => setShowIntake(false)} disabled={busy}>Cancel</button>
              <button
                className="btn-primary text-[11px]"
                onClick={() => { void submitIntake() }}
                disabled={busy}
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

const STATUS_PILL: Record<string, { label: string; tone: string }> = {
  available: { label: 'Available', tone: 'success' },
  assigned: { label: 'Reserved', tone: 'warning' },
  sold: { label: 'Sold', tone: 'info' },
  refurbishment: { label: 'Refurb', tone: 'neutral' },
  under_repair: { label: 'Under repair', tone: 'warning' },
  reconfiguration: { label: 'Reconfig', tone: 'neutral' },
  returned: { label: 'Returned', tone: 'warning' },
  written_off: { label: 'Written off', tone: 'danger' },
}

function SerialStatusPill({ status }: { status: string }) {
  const meta = STATUS_PILL[status] ?? { label: status.replace(/_/g, ' '), tone: 'neutral' }
  return <span className={`serial-pill serial-pill--${meta.tone}`}>{meta.label}</span>
}
