'use client'

import React, { useMemo, useState } from 'react'
import { Modal, Field, Input } from '@/components/ui'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { Fa } from '@/components/icons'
import { faPrint } from '@fortawesome/free-solid-svg-icons'
import { LOCATIONS, LocationId, Product, SerialNumber, useInventoryStore, fmtDate } from '@/lib/store'
import { validateSerialEdit } from '@/lib/inventory/serial-edit'

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
  const { serials: allSerials, updateSerial, addAuditLog, showToast } = useInventoryStore()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'available' | 'assigned' | 'refurbishment' | 'under_repair' | 'other'>('all')
  const [editTarget, setEditTarget] = useState<SerialNumber | null>(null)
  const [form, setForm] = useState({ serial: '', barcode: '', specs: '', conditionNotes: '', reason: '' })
  const [busy, setBusy] = useState(false)

  const scoped = useMemo(() => {
    return serials.filter(s => warehouseFilter === 'all' || s.location === warehouseFilter)
  }, [serials, warehouseFilter])

  const statusCounts = useMemo(() => {
    const counts = { available: 0, assigned: 0, refurbishment: 0, under_repair: 0, other: 0 }
    for (const s of scoped) {
      if (s.status === 'available') counts.available++
      else if (s.status === 'assigned') counts.assigned++
      else if (s.status === 'refurbishment') counts.refurbishment++
      else if (s.status === 'under_repair') counts.under_repair++
      else counts.other++
    }
    return counts
  }, [scoped])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return scoped.filter(s => {
      if (statusFilter === 'available' && s.status !== 'available') return false
      if (statusFilter === 'assigned' && s.status !== 'assigned') return false
      if (statusFilter === 'refurbishment' && s.status !== 'refurbishment') return false
      if (statusFilter === 'under_repair' && s.status !== 'under_repair') return false
      if (statusFilter === 'other' && ['available', 'assigned', 'refurbishment', 'under_repair'].includes(s.status)) return false
      if (!q) return true
      return (
        s.serial.toLowerCase().includes(q) ||
        String(s.barcode || '').toLowerCase().includes(q) ||
        String(s.sku || '').toLowerCase().includes(q)
      )
    })
  }, [scoped, search, statusFilter])

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
        </div>
      ),
      exportValue: row => row.serial,
    },
    {
      key: 'warehouse',
      label: 'Warehouse',
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
      render: row => <span className="text-xs capitalize text-text-2">{row.status.replace(/_/g, ' ')}</span>,
      exportValue: row => row.status,
    },
    {
      key: 'received',
      label: 'Received',
      priority: 3,
      width: '110px',
      render: row => <span className="text-xs text-text-3">{row.receivedDate ? fmtDate(row.receivedDate) : '—'}</span>,
      exportValue: row => row.receivedDate || '',
    },
  ]

  return (
    <>
      <Modal title={`Serials · ${product.name}`} onClose={onClose} width={960}>
        <div className="space-y-3">
          <p className="text-xs text-text-3">
            SKU {product.sku}
            {warehouseFilter !== 'all' ? ` · Filtered to ${LOCATIONS[warehouseFilter].name}` : ''}
          </p>
          <div className="flex flex-wrap gap-2 text-[10px]">
            {([
              ['all', `All (${scoped.length})`],
              ['available', `Available (${statusCounts.available})`],
              ['assigned', `Assigned (${statusCounts.assigned})`],
              ['refurbishment', `Refurb (${statusCounts.refurbishment})`],
              ['under_repair', `Under repair (${statusCounts.under_repair})`],
              ['other', `Other (${statusCounts.other})`],
            ] as const).map(([id, label]) => (
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
          {(statusCounts.assigned + statusCounts.refurbishment + statusCounts.under_repair) > 0 && (
            <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              On hand includes held units: {statusCounts.assigned} assigned (SO/repair pick), {statusCounts.refurbishment} refurbishment, {statusCounts.under_repair} under repair.
              Only Available counts toward free-to-sell stock.
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
            emptyMessage="No serials for this product"
            exportTitle={`${product.sku}-serials`}
            exportFilename={`${product.sku}-serials`}
            bulkActions={({ rows: selected, clear }) => (
              <div className="flex flex-wrap gap-2 items-center">
                <span className="text-xs font-bold">{selected.length} selected</span>
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
              <div className="flex gap-1 justify-end">
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
        <Modal onClose={() => setEditTarget(null)} title="Edit serial number" width={520}>
          <div className="space-y-3">
            <Field label="Serial number">
              <Input value={form.serial} onChange={v => setForm(prev => ({ ...prev, serial: v }))} />
            </Field>
            <Field label="Inventory barcode / asset tag">
              <Input value={form.barcode} onChange={v => setForm(prev => ({ ...prev, barcode: v }))} />
            </Field>
            <Field label="Specs">
              <Input value={form.specs} onChange={v => setForm(prev => ({ ...prev, specs: v }))} />
            </Field>
            <Field label="Condition notes">
              <Input value={form.conditionNotes} onChange={v => setForm(prev => ({ ...prev, conditionNotes: v }))} />
            </Field>
            <Field label="Reason (required for serial corrections)">
              <Input value={form.reason} onChange={v => setForm(prev => ({ ...prev, reason: v }))} />
            </Field>
            <p className="text-[11px] text-text-4">
              Warehouse/location changes must use Transfers. Quantity cannot be edited on a serial.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="btn-secondary" onClick={() => setEditTarget(null)}>Cancel</button>
              <button type="button" className="btn-primary" disabled={busy} onClick={() => { void saveEdit() }}>
                {busy ? 'Saving…' : 'Save serial'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
