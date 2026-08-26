'use client'

import { useMemo, useState } from 'react'
import { useFinanceStore, fmtDate, fmtKes, type CompanyAsset, type CompanyAssetInput } from '@/lib/store'
import { useHrStore } from '@/hooks/useHrStore'
import { canManageCompanyPropertyRole, hasModuleAccess } from '@/lib/auth/access'
import {
  CATEGORY_LABELS,
  CLASS_LABELS,
  CONDITION_LABELS,
  COMPANY_ASSET_CATEGORIES,
  COMPANY_ASSET_CLASSES,
  COMPANY_ASSET_CONDITIONS,
  COMPANY_ASSET_ACQUIRED_VIA,
  COMPANY_PROPERTY_LOCATIONS,
  PPE_ACCOUNT_LABELS,
  STATUS_BADGE,
  STATUS_LABELS,
  ACQUIRED_VIA_LABELS,
  capitalRegisterVsCoa,
  canDeleteCompanyAsset,
  defaultPpeAccountCode,
  isLiveCompanyAsset,
  isTerminalCompanyAssetStatus,
  type CompanyAssetCategory,
  type CompanyAssetClass,
  type CompanyAssetCondition,
  type CompanyAssetAcquiredVia,
  type CompanyAssetStatus,
} from '@/lib/company-property'
import { ModuleSkeleton, useMounted, ModuleHeader, Field, Input, Select, Textarea, Modal } from '@/components/ui'
import { PrimaryActionButton, SecondaryActionMenu, StatusBadge, RecordHeader, CompactInfoNotice, PermissionDeniedState } from '@/components/erp'
import { DataTable, type ColumnDef, type PrimaryFilterConfig } from '@/components/data-table'
import { Fa } from '@/components/icons'
import { faChair, faPlus } from '@fortawesome/free-solid-svg-icons'
import { useUrlRecordId } from '@/hooks/useUrlRecordId'

type FormState = {
  name: string
  description: string
  category: CompanyAssetCategory
  assetClass: CompanyAssetClass
  ppeAccountCode: string
  qty: string
  unit: string
  assetTag: string
  serialNumber: string
  locationName: string
  customLocation: string
  custodianEmployeeId: string
  status: 'draft' | 'in_use' | 'in_storage'
  condition: CompanyAssetCondition
  acquiredDate: string
  acquiredVia: CompanyAssetAcquiredVia
  supplierName: string
  purchaseOrderRef: string
  billRef: string
  costKes: string
  notes: string
}

type ActionKind = 'move' | 'custodian' | 'repair' | 'dispose' | 'writeoff' | 'delete' | null

const today = () => new Date().toISOString().slice(0, 10)

function emptyForm(): FormState {
  return {
    name: '',
    description: '',
    category: 'furniture',
    assetClass: 'capital',
    ppeAccountCode: '1702',
    qty: '1',
    unit: 'each',
    assetTag: '',
    serialNumber: '',
    locationName: 'Reception',
    customLocation: '',
    custodianEmployeeId: '',
    status: 'in_use',
    condition: 'good',
    acquiredDate: today(),
    acquiredVia: 'purchase',
    supplierName: '',
    purchaseOrderRef: '',
    billRef: '',
    costKes: '',
    notes: '',
  }
}

function formFromAsset(asset: CompanyAsset): FormState {
  const preset = (COMPANY_PROPERTY_LOCATIONS as readonly string[]).includes(asset.locationName)
  return {
    name: asset.name,
    description: asset.description ?? '',
    category: asset.category,
    assetClass: asset.assetClass,
    ppeAccountCode: asset.ppeAccountCode ?? defaultPpeAccountCode(asset.category) ?? '',
    qty: String(asset.qty),
    unit: asset.unit || 'each',
    assetTag: asset.assetTag ?? '',
    serialNumber: asset.serialNumber ?? '',
    locationName: preset ? asset.locationName : 'Other',
    customLocation: preset ? '' : asset.locationName,
    custodianEmployeeId: asset.custodianEmployeeId ?? '',
    status: asset.status === 'in_storage' ? 'in_storage' : asset.status === 'draft' ? 'draft' : 'in_use',
    condition: asset.condition,
    acquiredDate: asset.acquiredDate.slice(0, 10),
    acquiredVia: asset.acquiredVia,
    supplierName: asset.supplierName ?? '',
    purchaseOrderRef: asset.purchaseOrderRef ?? '',
    billRef: asset.billRef ?? '',
    costKes: String(asset.costKes ?? ''),
    notes: asset.notes ?? '',
  }
}

function resolvedLocation(form: FormState): string {
  return form.locationName === 'Other' ? form.customLocation.trim() : form.locationName
}

function toInput(form: FormState, employees: Array<{ id: string; fullName: string }>): CompanyAssetInput {
  const custodian = employees.find(e => e.id === form.custodianEmployeeId)
  return {
    name: form.name,
    description: form.description,
    category: form.category,
    assetClass: form.assetClass,
    ppeAccountCode: form.assetClass === 'capital' ? form.ppeAccountCode : undefined,
    qty: Number(form.qty),
    unit: form.unit,
    assetTag: form.assetTag,
    serialNumber: form.serialNumber,
    locationName: resolvedLocation(form),
    custodianEmployeeId: form.custodianEmployeeId || undefined,
    custodianName: custodian?.fullName,
    status: form.status,
    condition: form.condition,
    acquiredDate: form.acquiredDate,
    acquiredVia: form.acquiredVia,
    supplierName: form.supplierName,
    purchaseOrderRef: form.purchaseOrderRef,
    billRef: form.billRef,
    costKes: Number(form.costKes) || 0,
    notes: form.notes,
  }
}

function PropertyStatusBadge({ status }: { status: CompanyAssetStatus }) {
  return <StatusBadge status={STATUS_BADGE[status]} label={STATUS_LABELS[status]} />
}

function PropertyFormFields({
  form,
  setForm,
  employeeOptions,
  allowStatus,
}: {
  form: FormState
  setForm: (next: FormState | ((prev: FormState) => FormState)) => void
  employeeOptions: { value: string; label: string }[]
  allowStatus: boolean
}) {
  const patch = (partial: Partial<FormState>) => setForm(prev => ({ ...prev, ...partial }))
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div className="sm:col-span-2">
        <Field label="Item name" required>
          <Input value={form.name} onChange={name => patch({ name })} placeholder="Visitor chairs, filing cabinet…" />
        </Field>
      </div>
      <Field label="Category" required>
        <Select
          value={form.category}
          onChange={category => {
            const next = category as CompanyAssetCategory
            patch({
              category: next,
              ppeAccountCode: form.assetClass === 'capital' ? (defaultPpeAccountCode(next) ?? form.ppeAccountCode) : '',
            })
          }}
          options={COMPANY_ASSET_CATEGORIES.map(value => ({ value, label: CATEGORY_LABELS[value] }))}
        />
      </Field>
      <Field label="Class" required hint="Capital sits on PPE. Expensed items are recorded for control only.">
        <Select
          value={form.assetClass}
          onChange={assetClass => {
            const next = assetClass as CompanyAssetClass
            patch({
              assetClass: next,
              ppeAccountCode: next === 'capital' ? (defaultPpeAccountCode(form.category) ?? '1702') : '',
            })
          }}
          options={COMPANY_ASSET_CLASSES.map(value => ({ value, label: CLASS_LABELS[value] }))}
        />
      </Field>
      {form.assetClass === 'capital' && (
        <Field label="PPE account" required>
          <Select
            value={form.ppeAccountCode}
            onChange={ppeAccountCode => patch({ ppeAccountCode })}
            options={Object.entries(PPE_ACCOUNT_LABELS).map(([value, label]) => ({ value, label }))}
          />
        </Field>
      )}
      <Field label="Quantity" required>
        <Input type="number" value={form.qty} onChange={qty => patch({ qty })} />
      </Field>
      <Field label="Unit">
        <Input value={form.unit} onChange={unit => patch({ unit })} placeholder="each" />
      </Field>
      <Field label="Asset tag" hint="Unique when set. Use for tagged desks and machines.">
        <Input value={form.assetTag} onChange={assetTag => patch({ assetTag })} placeholder="FUR-001" />
      </Field>
      <Field label="Serial number">
        <Input value={form.serialNumber} onChange={serialNumber => patch({ serialNumber })} />
      </Field>
      <Field label="Location" required hint="Office rooms only — not warehouse, shop, or repair unit.">
        <Select
          value={form.locationName}
          onChange={locationName => patch({ locationName })}
          options={[
            ...COMPANY_PROPERTY_LOCATIONS.map(value => ({ value, label: value })),
            { value: 'Other', label: 'Other…' },
          ]}
        />
      </Field>
      {form.locationName === 'Other' && (
        <Field label="Room / area" required>
          <Input value={form.customLocation} onChange={customLocation => patch({ customLocation })} placeholder="First-floor corridor" />
        </Field>
      )}
      <Field label="Custodian" hint="Optional person. This does not move trading stock or create an HR assignment.">
        <Select value={form.custodianEmployeeId} onChange={custodianEmployeeId => patch({ custodianEmployeeId })} options={employeeOptions} />
      </Field>
      {allowStatus && (
        <Field label="Status">
          <Select
            value={form.status}
            onChange={status => patch({ status: status as FormState['status'] })}
            options={[
              { value: 'draft', label: 'Draft' },
              { value: 'in_use', label: 'In use' },
              { value: 'in_storage', label: 'In storage' },
            ]}
          />
        </Field>
      )}
      <Field label="Condition">
        <Select
          value={form.condition}
          onChange={condition => patch({ condition: condition as CompanyAssetCondition })}
          options={COMPANY_ASSET_CONDITIONS.map(value => ({ value, label: CONDITION_LABELS[value] }))}
        />
      </Field>
      <Field label="Acquired date" required>
        <Input type="date" value={form.acquiredDate} onChange={acquiredDate => patch({ acquiredDate })} />
      </Field>
      <Field label="Acquired via" required>
        <Select
          value={form.acquiredVia}
          onChange={acquiredVia => patch({ acquiredVia: acquiredVia as CompanyAssetAcquiredVia })}
          options={COMPANY_ASSET_ACQUIRED_VIA.map(value => ({ value, label: ACQUIRED_VIA_LABELS[value] }))}
        />
      </Field>
      <Field label="Cost (KES)" hint={form.acquiredVia === 'opening' ? 'Opening items are not posted to the ledger.' : 'Total for this row. No journal is posted in v1.'}>
        <Input type="number" value={form.costKes} onChange={costKes => patch({ costKes })} placeholder="0" />
      </Field>
      <Field label="Supplier">
        <Input value={form.supplierName} onChange={supplierName => patch({ supplierName })} />
      </Field>
      <Field label="PO / bill ref">
        <Input value={form.purchaseOrderRef || form.billRef} onChange={purchaseOrderRef => patch({ purchaseOrderRef, billRef: purchaseOrderRef })} placeholder="PO/2026/0041" />
      </Field>
      <div className="sm:col-span-2">
        <Field label="Description">
          <Textarea value={form.description} onChange={description => patch({ description })} rows={2} />
        </Field>
      </div>
      <div className="sm:col-span-2">
        <Field label="Notes">
          <Textarea value={form.notes} onChange={notes => patch({ notes })} rows={2} />
        </Field>
      </div>
    </div>
  )
}

export default function CompanyProperty() {
  const mounted = useMounted()
  const [recordId, setRecordId] = useUrlRecordId()
  const {
    companyAssets,
    accounts,
    currentUser,
    createCompanyAsset,
    updateCompanyAsset,
    deleteCompanyAsset,
    moveCompanyAsset,
    setCompanyAssetCustodian,
    setCompanyAssetStatus,
    disposeCompanyAsset,
    writeOffCompanyAsset,
  } = useFinanceStore()
  const { employees } = useHrStore()

  const canOpen = hasModuleAccess(currentUser, 'company_property')
  const canManage = canManageCompanyPropertyRole(currentUser?.role)

  const [filter, setFilter] = useState<'all' | CompanyAssetStatus>('all')
  const [search, setSearch] = useState('')
  const [form, setForm] = useState<FormState>(emptyForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [action, setAction] = useState<ActionKind>(null)
  const [actionNote, setActionNote] = useState('')
  const [actionLocation, setActionLocation] = useState('')
  const [actionCustomLocation, setActionCustomLocation] = useState('')
  const [actionCustodianId, setActionCustodianId] = useState('')
  const [actionQty, setActionQty] = useState('1')
  const [actionProceeds, setActionProceeds] = useState('')

  const items = Array.isArray(companyAssets) ? companyAssets : []
  const selected = items.find(a => a.id === recordId) ?? null

  const employeeOptions = useMemo(() => {
    const active = employees.filter(e => e.status !== 'exited')
    return [
      { value: '', label: 'No custodian' },
      ...active.map(e => ({ value: e.id, label: `${e.fullName}${e.jobTitle ? ` · ${e.jobTitle}` : ''}` })),
    ]
  }, [employees])

  const inUse = items.filter(a => a.status === 'in_use')
  const inStorage = items.filter(a => a.status === 'in_storage')
  const missingLocation = items.filter(a => isLiveCompanyAsset(a) && !a.locationName.trim())
  const capitalCost = items.filter(a => a.assetClass === 'capital' && isLiveCompanyAsset(a)).reduce((sum, a) => sum + (Number(a.costKes) || 0), 0)
  const coaRows = capitalRegisterVsCoa(items, accounts ?? [])
  const coaMismatch = coaRows.some(row => row.register > 0 && row.delta !== 0)

  const filtered = useMemo(() => {
    let list = filter === 'all' ? items : items.filter(a => a.status === filter)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(a =>
        a.ref.toLowerCase().includes(q)
        || a.name.toLowerCase().includes(q)
        || (a.assetTag ?? '').toLowerCase().includes(q)
        || (a.serialNumber ?? '').toLowerCase().includes(q)
        || a.locationName.toLowerCase().includes(q)
        || (a.custodianName ?? '').toLowerCase().includes(q),
      )
    }
    return [...list].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
  }, [items, filter, search])

  const statusFilters: PrimaryFilterConfig[] = [
    {
      key: 'status',
      label: 'Status',
      placeholder: 'All statuses',
      value: filter,
      options: [
        { value: 'all', label: `All (${items.length})` },
        ...(['draft', 'in_use', 'in_storage', 'under_repair', 'lost', 'disposed', 'written_off'] as CompanyAssetStatus[]).map(status => ({
          value: status,
          label: `${STATUS_LABELS[status]} (${items.filter(a => a.status === status).length})`,
        })),
      ],
      onChange: value => setFilter(value as 'all' | CompanyAssetStatus),
    },
  ]

  const columns: ColumnDef<CompanyAsset>[] = [
    {
      key: 'ref', label: 'Ref', priority: 1, width: '120px',
      render: a => <span className="font-mono text-[12px] font-bold text-blue-500">{a.ref}</span>,
      exportValue: a => a.ref,
    },
    {
      key: 'name', label: 'Item', priority: 1,
      render: a => (
        <div className="min-w-0">
          <p className="font-semibold text-[var(--text-1)] truncate">{a.name}</p>
          <p className="text-[11px] text-[var(--text-4)]">{CATEGORY_LABELS[a.category]} · {a.qty} {a.unit}</p>
        </div>
      ),
      exportValue: a => a.name,
    },
    {
      key: 'location', label: 'Location', priority: 2,
      render: a => a.locationName || '—',
      exportValue: a => a.locationName,
    },
    {
      key: 'custodian', label: 'Custodian', priority: 3,
      render: a => a.custodianName || '—',
      exportValue: a => a.custodianName ?? '',
    },
    {
      key: 'class', label: 'Class', priority: 3,
      render: a => CLASS_LABELS[a.assetClass],
      exportValue: a => CLASS_LABELS[a.assetClass],
    },
    {
      key: 'cost', label: 'Cost', priority: 2, align: 'right',
      render: a => fmtKes(a.costKes),
      exportValue: a => String(a.costKes ?? 0),
    },
    {
      key: 'status', label: 'Status', priority: 1, width: '120px',
      render: a => <PropertyStatusBadge status={a.status} />,
      exportValue: a => STATUS_LABELS[a.status],
    },
  ]

  const openCreate = () => {
    setEditingId(null)
    setForm(emptyForm())
    setShowForm(true)
  }

  const openEdit = (asset: CompanyAsset) => {
    setEditingId(asset.id)
    setForm(formFromAsset(asset))
    setShowForm(true)
  }

  const saveForm = () => {
    const input = toInput(form, employees)
    if (editingId) updateCompanyAsset(editingId, input)
    else {
      const created = createCompanyAsset(input)
      if (created) setRecordId(created.id)
    }
    setShowForm(false)
  }

  const closeAction = () => {
    setAction(null)
    setActionNote('')
    setActionLocation('')
    setActionCustomLocation('')
    setActionCustodianId('')
    setActionQty('1')
    setActionProceeds('')
  }

  const runAction = () => {
    if (!selected) return
    if (action === 'move') {
      const location = actionLocation === 'Other' ? actionCustomLocation : actionLocation
      moveCompanyAsset(selected.id, location, actionNote || undefined)
    } else if (action === 'custodian') {
      const emp = employees.find(e => e.id === actionCustodianId)
      setCompanyAssetCustodian(selected.id, { employeeId: actionCustodianId || undefined, name: emp?.fullName }, actionNote || undefined)
    } else if (action === 'repair') {
      setCompanyAssetStatus(selected.id, selected.status === 'under_repair' ? 'in_use' : 'under_repair', actionNote || undefined)
    } else if (action === 'dispose') {
      disposeCompanyAsset(selected.id, Number(actionQty), { reason: actionNote || undefined, proceedsKes: Number(actionProceeds) || undefined })
    } else if (action === 'writeoff') {
      writeOffCompanyAsset(selected.id, actionNote || undefined)
    } else if (action === 'delete') {
      deleteCompanyAsset(selected.id)
      setRecordId(null)
    }
    closeAction()
  }

  if (!mounted) return <ModuleSkeleton />
  if (!canOpen) {
    return (
      <div className="mod-page">
        <PermissionDeniedState
          title="Property"
          description="Company Property is limited to the Director, Admin Officer, and Finance Officer."
        />
      </div>
    )
  }

  if (selected) {
    const live = isLiveCompanyAsset(selected)
    const terminal = isTerminalCompanyAssetStatus(selected.status)
    return (
      <div className="mod-page">
        <RecordHeader
          title={selected.name}
          entity={selected.ref}
          status={STATUS_BADGE[selected.status]}
          statusLabel={STATUS_LABELS[selected.status]}
          onBack={() => setRecordId(null)}
          backLabel="All property"
          primaryAction={canManage && live ? (
            <PrimaryActionButton onClick={() => { setActionLocation(selected.locationName); setAction('move') }}>
              Move
            </PrimaryActionButton>
          ) : canManage && selected.status === 'draft' ? (
            <PrimaryActionButton onClick={() => openEdit(selected)}>Edit</PrimaryActionButton>
          ) : undefined}
          secondaryActions={canManage ? (
            <SecondaryActionMenu
              actions={[
                { id: 'edit', label: 'Edit details', onClick: () => openEdit(selected), hidden: terminal },
                { id: 'custodian', label: 'Set custodian', onClick: () => { setActionCustodianId(selected.custodianEmployeeId ?? ''); setAction('custodian') }, hidden: !live },
                { id: 'repair', label: selected.status === 'under_repair' ? 'Return from repair' : 'Mark under repair', onClick: () => setAction('repair'), hidden: !live && selected.status !== 'under_repair' },
                { id: 'lost', label: 'Mark lost', onClick: () => setCompanyAssetStatus(selected.id, 'lost'), hidden: !live || selected.status === 'lost' },
                { id: 'storage', label: 'Move to storage', onClick: () => setCompanyAssetStatus(selected.id, 'in_storage'), hidden: selected.status !== 'in_use' },
                { id: 'use', label: 'Put in use', onClick: () => setCompanyAssetStatus(selected.id, 'in_use'), hidden: selected.status !== 'in_storage' && selected.status !== 'draft' && selected.status !== 'lost' && selected.status !== 'under_repair' },
                { id: 'dispose', label: 'Dispose…', onClick: () => { setActionQty(String(selected.qty)); setAction('dispose') }, hidden: !live, danger: true },
                { id: 'writeoff', label: 'Write off…', onClick: () => setAction('writeoff'), hidden: !live && selected.status !== 'lost', danger: true },
                { id: 'delete', label: 'Delete draft', onClick: () => setAction('delete'), hidden: !canDeleteCompanyAsset(selected.status), danger: true },
              ]}
            />
          ) : undefined}
        />

        <div className="mod-body p-4 sm:p-5 space-y-4">
          <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
            {[
              ['Category', CATEGORY_LABELS[selected.category]],
              ['Class', CLASS_LABELS[selected.assetClass]],
              ['PPE account', selected.ppeAccountCode ? (PPE_ACCOUNT_LABELS[selected.ppeAccountCode] ?? selected.ppeAccountCode) : '—'],
              ['Quantity', `${selected.qty} ${selected.unit}`],
              ['Asset tag', selected.assetTag || '—'],
              ['Serial', selected.serialNumber || '—'],
              ['Location', selected.locationName],
              ['Custodian', selected.custodianName || '—'],
              ['Condition', CONDITION_LABELS[selected.condition]],
              ['Acquired', `${fmtDate(selected.acquiredDate)} · ${ACQUIRED_VIA_LABELS[selected.acquiredVia]}`],
              ['Cost', fmtKes(selected.costKes)],
              ['Supplier', selected.supplierName || '—'],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-[var(--border-lt)] bg-[var(--bg-surface)] px-3 py-2.5">
                <dt className="text-[10px] uppercase tracking-wider font-bold text-[var(--text-4)]">{label}</dt>
                <dd className="mt-1 text-[var(--text-1)] font-medium">{value}</dd>
              </div>
            ))}
          </dl>
          {selected.description && <p className="text-sm text-[var(--text-2)]">{selected.description}</p>}
          {selected.notes && <p className="text-[12px] text-[var(--text-3)]">{selected.notes}</p>}
          {selected.acquiredVia === 'opening' && (
            <CompactInfoNotice>Opening register item — this cost is not posted as a journal.</CompactInfoNotice>
          )}
          {selected.history.length > 0 && (
            <section>
              <h2 className="text-sm font-bold text-[var(--text-1)] mb-2">History</h2>
              <ol className="space-y-2">
                {[...selected.history].reverse().map(entry => (
                  <li key={entry.id} className="text-[12px] border-l-2 border-[var(--border)] pl-3">
                    <p className="font-semibold text-[var(--text-1)] capitalize">{entry.action.replace(/_/g, ' ')}</p>
                    <p className="text-[var(--text-3)]">
                      {fmtDate(entry.at)} · {entry.userName}
                      {entry.fromLocation && entry.toLocation ? ` · ${entry.fromLocation} → ${entry.toLocation}` : ''}
                      {entry.fromStatus && entry.toStatus ? ` · ${STATUS_LABELS[entry.fromStatus]} → ${STATUS_LABELS[entry.toStatus]}` : ''}
                    </p>
                    {entry.note && <p className="text-[var(--text-4)]">{entry.note}</p>}
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>

        {showForm && (
          <Modal
            title={editingId ? `Edit ${selected.ref}` : 'Record property'}
            subtitle="Office furniture and fittings — not trading stock"
            onClose={() => setShowForm(false)}
            width={720}
            variant="enterprise"
            footer={
              <div className="flex justify-end gap-2">
                <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
                <button type="button" className="btn-primary" onClick={saveForm}>{editingId ? 'Save' : 'Record'}</button>
              </div>
            }
          >
            <PropertyFormFields form={form} setForm={setForm} employeeOptions={employeeOptions} allowStatus={selected.status === 'draft'} />
          </Modal>
        )}

        {action && (
          <Modal
            title={
              action === 'move' ? 'Move item'
                : action === 'custodian' ? 'Set custodian'
                  : action === 'repair' ? (selected.status === 'under_repair' ? 'Return from repair' : 'Mark under repair')
                    : action === 'dispose' ? 'Dispose'
                      : action === 'writeoff' ? 'Write off'
                        : 'Delete draft'
            }
            onClose={closeAction}
            width={480}
            variant="enterprise"
            footer={
              <div className="flex justify-end gap-2">
                <button type="button" className="btn-secondary" onClick={closeAction}>Cancel</button>
                <button type="button" className={action === 'delete' || action === 'dispose' || action === 'writeoff' ? 'btn-danger' : 'btn-primary'} onClick={runAction}>
                  Confirm
                </button>
              </div>
            }
          >
            {action === 'move' && (
              <div className="space-y-3">
                <Field label="New location" required>
                  <Select
                    value={actionLocation}
                    onChange={setActionLocation}
                    options={[
                      ...COMPANY_PROPERTY_LOCATIONS.map(value => ({ value, label: value })),
                      { value: 'Other', label: 'Other…' },
                    ]}
                  />
                </Field>
                {actionLocation === 'Other' && (
                  <Field label="Room / area" required>
                    <Input value={actionCustomLocation} onChange={setActionCustomLocation} />
                  </Field>
                )}
                <Field label="Note"><Textarea value={actionNote} onChange={setActionNote} rows={2} /></Field>
              </div>
            )}
            {action === 'custodian' && (
              <div className="space-y-3">
                <Field label="Custodian" hint="Does not create an HR asset assignment or move inventory.">
                  <Select value={actionCustodianId} onChange={setActionCustodianId} options={employeeOptions} />
                </Field>
                <Field label="Note"><Textarea value={actionNote} onChange={setActionNote} rows={2} /></Field>
              </div>
            )}
            {action === 'repair' && (
              <Field label="Note"><Textarea value={actionNote} onChange={setActionNote} rows={2} placeholder="What is being repaired?" /></Field>
            )}
            {action === 'dispose' && (
              <div className="space-y-3">
                <p className="text-[12px] text-[var(--text-3)]">v1 does not post a disposal journal. Partial quantities stay on the register.</p>
                <Field label="Quantity to dispose" required>
                  <Input type="number" value={actionQty} onChange={setActionQty} />
                </Field>
                <Field label="Proceeds (KES)">
                  <Input type="number" value={actionProceeds} onChange={setActionProceeds} placeholder="0" />
                </Field>
                <Field label="Reason"><Textarea value={actionNote} onChange={setActionNote} rows={2} /></Field>
              </div>
            )}
            {action === 'writeoff' && (
              <Field label="Reason" required><Textarea value={actionNote} onChange={setActionNote} rows={3} placeholder="Lost, damaged beyond repair, stolen…" /></Field>
            )}
            {action === 'delete' && (
              <p className="text-sm text-[var(--text-2)]">Delete draft {selected.ref}? Live items must be disposed or written off.</p>
            )}
          </Modal>
        )}
      </div>
    )
  }

  return (
    <div className="mod-page">
      <ModuleHeader
        title="Property"
        subtitle="Office furniture, fittings, and equipment — not trading stock"
        icon={<Fa icon={faChair} />}
        count={items.length}
        color="var(--navy)"
        primaryAction={canManage ? (
          <PrimaryActionButton icon={<Fa icon={faPlus} />} onClick={openCreate} hideLabelOnMobile={false} aria-label="Record property">
            Record item
          </PrimaryActionButton>
        ) : undefined}
      />

      <div className="kpi-summary-strip" aria-label="Property overview">
        <article className="kpi-summary-card kpi-summary-card--green"><span>In use</span><strong>{inUse.length}</strong></article>
        <article className="kpi-summary-card"><span>In storage</span><strong>{inStorage.length}</strong></article>
        <article className="kpi-summary-card"><span>Capital on register</span><strong>{fmtKes(capitalCost)}</strong></article>
        <article className={`kpi-summary-card ${missingLocation.length ? 'kpi-summary-card--amber' : ''}`}><span>Missing location</span><strong>{missingLocation.length}</strong></article>
      </div>

      <div className="px-3 sm:px-6 pt-3 space-y-2">
        <CompactInfoNotice>
          This register is for office furniture and fittings. Staff laptops and phones issued from stock stay on HR → Assets. v1 does not post journals or depreciation. Monthly depreciation, bill/PO capitalisation, and disposal journals are Phase 2.
        </CompactInfoNotice>
        {coaMismatch && (
          <CompactInfoNotice>
            Capital totals on this register do not match COA 1701–1703. That is expected for opening items that already sit on the ledger — do not post them again.
            {coaRows.filter(row => row.register > 0).map(row => (
              <span key={row.code}> {row.code}: register {fmtKes(row.register)} vs COA {fmtKes(row.coa)}.</span>
            ))}
          </CompactInfoNotice>
        )}
        {!canManage && (
          <CompactInfoNotice>Finance can view costs and class. Recording, moves, and disposals are Admin Officer / Director only.</CompactInfoNotice>
        )}
      </div>

      <div className="mod-body overflow-y-auto custom-scrollbar p-3 sm:p-4">
        <DataTable
          tableId="company_property"
          columns={columns}
          rows={filtered}
          rowKey={a => a.id}
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search by name, tag, serial, location…"
          clientSearch={false}
          primaryFilters={statusFilters}
          onClearFilters={() => { setSearch(''); setFilter('all') }}
          hideColumnFilters
          emptyMessage={search || filter !== 'all' ? 'No matching property' : 'No company property recorded'}
          emptyAction={!search && filter === 'all' && canManage ? (
            <button type="button" onClick={openCreate} className="mt-2 px-5 py-2.5 rounded-xl bg-blue-600 text-white text-xs font-black uppercase tracking-wider hover:bg-blue-700">
              + Record item
            </button>
          ) : undefined}
          onRowClick={a => setRecordId(a.id)}
          exportTitle="Company Property"
          exportFilename="company-property"
        />
      </div>

      {showForm && (
        <Modal
          title="Record property"
          subtitle="Office furniture and fittings — not trading stock"
          onClose={() => setShowForm(false)}
          width={720}
          variant="enterprise"
          footer={
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
              <button type="button" className="btn-primary" onClick={saveForm}>Record</button>
            </div>
          }
        >
          <PropertyFormFields form={form} setForm={setForm} employeeOptions={employeeOptions} allowStatus />
        </Modal>
      )}
    </div>
  )
}
