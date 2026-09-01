'use client'
import { useMemo, useState } from 'react'
import { useApp, fmtDate, type EmployeeAssetAssignment, type LocationId } from '@/lib/store'
import { useHrStore } from '@/hooks/useHrStore'
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard'
import { Fa } from '@/components/icons'
import { faLaptop, faPlus, faRotateLeft } from '@fortawesome/free-solid-svg-icons'
import { Input, Modal, Select, Textarea } from '@/components/ui'
import { AsyncActionButton, FormField, PrimaryActionButton, StatusBadge } from '@/components/erp'
import { DataTable, type ColumnDef } from '@/components/data-table'

type AssignForm = {
  employeeId: string
  productId: string
  serialId: string
  qty: string
  handoverCondition: EmployeeAssetAssignment['handoverCondition']
  handoverNotes: string
}

type ReturnForm = {
  assignmentId: string
  returnLocation: LocationId
  condition: 'good' | 'fair' | 'damaged'
  notes: string
}

const emptyAssignForm = (employeeId = '', productId = ''): AssignForm => ({
  employeeId,
  productId,
  serialId: '',
  qty: '1',
  handoverCondition: 'good',
  handoverNotes: '',
})

const emptyReturnForm = (assignmentId = ''): ReturnForm => ({
  assignmentId,
  returnLocation: 'warehouse',
  condition: 'good',
  notes: '',
})

export default function HRAssetsTab() {
  const { employees } = useHrStore()
  const {
    employeeAssetAssignments,
    currentUser,
    products,
    serials,
    assignAssetToEmployee,
    returnEmployeeAsset,
    showToast,
  } = useApp()
  const isAdmin = currentUser?.role === 'director'
  const isFinance = currentUser?.role === 'finance_officer'
  const canViewAllAssignments = isAdmin || isFinance
  const currentEmployee = useMemo(() => {
    if (!currentUser) return null
    const normalize = (value?: string | null) => (value ?? '').trim().toLowerCase()
    const currentUsername = normalize(currentUser.username)
    return employees.find(employee => {
      const employeeEmailUser = normalize(employee.email?.split('@')[0])
      return employee.userId === currentUser.id ||
        normalize(employee.fullName) === normalize(currentUser.name) ||
        (!!employeeEmailUser && employeeEmailUser === currentUsername) ||
        normalize(employee.employeeNo) === currentUsername
    }) ?? null
  }, [currentUser, employees])
  const visibleAssignments = canViewAllAssignments ? employeeAssetAssignments : employeeAssetAssignments.filter(a => currentEmployee && a.employeeId === currentEmployee.id)
  const [showAssignModal, setShowAssignModal] = useState(false)
  const [returnForm, setReturnForm] = useState<ReturnForm | null>(null)
  const [assignDirty, setAssignDirty] = useState(false)
  const [returnDirty, setReturnDirty] = useState(false)
  const [assignError, setAssignError] = useState<string | null>(null)
  const [returnError, setReturnError] = useState<string | null>(null)
  const { guardedNavigate } = useUnsavedChangesGuard(
    (showAssignModal && assignDirty) || (!!returnForm && returnDirty),
    'You have unsaved asset changes. Discard them?'
  )

  const activeEmployees = employees.filter(e => e.status !== 'exited')
  const assignableProducts = useMemo(() => {
    return products.filter(p => {
      if (!p.isActive) return false
      if (p.requiresSerial) return serials.some(s => s.productId === p.id && s.status === 'available')
      return p.stockQty > 0
    })
  }, [products, serials])

  const [assignForm, setAssignForm] = useState<AssignForm>(() => emptyAssignForm(activeEmployees[0]?.id ?? '', assignableProducts[0]?.id ?? ''))
  const selectedProduct = assignableProducts.find(p => p.id === assignForm.productId)
  const availableSerials = serials.filter(s => s.productId === assignForm.productId && s.status === 'available')
  const selectedReturn = returnForm && isAdmin ? employeeAssetAssignments.find(a => a.id === returnForm.assignmentId) : null

  const employeeOptions = activeEmployees.map(e => ({ value: e.id, label: `${e.fullName} · ${e.jobTitle}` }))
  const productOptions = assignableProducts.map(p => ({ value: p.id, label: `${p.name} (${p.requiresSerial ? `${serials.filter(s => s.productId === p.id && s.status === 'available').length} serials` : `${p.stockQty} ${p.unit}`})` }))
  const serialOptions = availableSerials.map(s => ({ value: s.id, label: `${s.serial}${s.specs ? ` · ${s.specs}` : ''}` }))

  const updateAssign = (patch: Partial<AssignForm>) => {
    setAssignDirty(true)
    setAssignError(null)
    setAssignForm(p => ({ ...p, ...patch }))
  }

  const updateReturn = (patch: Partial<ReturnForm>) => {
    setReturnDirty(true)
    setReturnError(null)
    setReturnForm(p => p ? ({ ...p, ...patch }) : p)
  }

  const openAssignModal = () => {
    setAssignForm(emptyAssignForm(activeEmployees[0]?.id ?? '', assignableProducts[0]?.id ?? ''))
    setAssignDirty(false)
    setAssignError(null)
    setShowAssignModal(true)
  }

  const closeAssignModal = () => guardedNavigate(() => {
    setShowAssignModal(false)
    setAssignDirty(false)
    setAssignError(null)
  })

  const closeReturnModal = () => guardedNavigate(() => {
    setReturnForm(null)
    setReturnDirty(false)
    setReturnError(null)
  })

  const submitAssign = async () => {
    const product = assignableProducts.find(p => p.id === assignForm.productId)
    const qty = product?.requiresSerial ? 1 : Number(assignForm.qty)
    if (!assignForm.employeeId) { setAssignError('Select an employee for the asset assignment.'); return }
    if (!product) { setAssignError('Select an available asset to assign.'); return }
    if (product.requiresSerial && !assignForm.serialId) { setAssignError('Select the serial number being assigned.'); return }
    if (!product.requiresSerial && (!Number.isFinite(qty) || qty <= 0)) { setAssignError('Quantity must be greater than zero.'); return }
    if (!product.requiresSerial && qty > product.stockQty) { setAssignError('Quantity exceeds available stock.'); return }

    await Promise.resolve(assignAssetToEmployee(
      assignForm.employeeId,
      product.id,
      qty,
      product.requiresSerial ? assignForm.serialId : undefined,
      assignForm.handoverCondition,
      assignForm.handoverNotes.trim()
    ))
    setAssignDirty(false)
    setShowAssignModal(false)
    showToast('Asset assignment saved', 'success')
  }

  const submitReturn = async () => {
    if (!returnForm) return
    if (!returnForm.assignmentId) { setReturnError('Select an asset assignment to return.'); return }
    if (!returnForm.notes.trim()) { setReturnError('Return inspection notes are required.'); return }
    await Promise.resolve(returnEmployeeAsset(returnForm.assignmentId, returnForm.returnLocation, returnForm.condition, returnForm.notes.trim()))
    setReturnDirty(false)
    setReturnForm(null)
    showToast('Asset return recorded', 'success')
  }

  type Assignment = typeof visibleAssignments[number]

  const assetColumns: ColumnDef<Assignment>[] = [
    {
      key: 'employee', label: 'Employee', priority: 1, width: '1.2fr',
      render: a => (
        <div>
          <p className="text-xs font-bold text-[var(--text-1)]">{a.employeeName}</p>
          <p className="text-[10px] text-[var(--text-4)]">ID: {a.employeeId.slice(0, 8)}</p>
        </div>
      ),
      exportValue: a => a.employeeName,
    },
    {
      key: 'asset', label: 'Asset', priority: 1, width: '1.2fr',
      render: a => (
        <div className="flex items-center gap-2">
          <Fa icon={faLaptop} className="text-[var(--text-4)]" />
          <div>
            <p className="text-xs font-bold text-[var(--text-1)]">{a.productName}</p>
            {a.serialNumber && <p className="text-[10px] text-[var(--text-4)]">SN: {a.serialNumber}</p>}
          </div>
        </div>
      ),
      exportValue: a => a.productName,
    },
    {
      key: 'status', label: 'Status', priority: 1, width: '150px',
      render: a => (
        <div className="flex items-center gap-1.5 flex-wrap">
          <StatusBadge
            status={a.status === 'assigned' ? 'active' : 'done'}
            label={a.status === 'assigned' ? 'Assigned' : 'Returned'}
            size="xs"
          />
          {a.acknowledgedByEmployee && (
            <StatusBadge status="done" label="Acknowledged" size="xs" />
          )}
        </div>
      ),
      exportValue: a => a.status,
    },
    {
      key: 'assignedDate', label: 'Assigned Date', priority: 2, width: '120px',
      render: a => <span className="text-xs text-[var(--text-3)]">{fmtDate(a.assignedDate)}</span>,
      exportValue: a => a.assignedDate,
    },
  ]

  function assetRowActions(a: Assignment) {
    return a.status === 'assigned' && isAdmin ? (
      <button onClick={e => { e.stopPropagation(); setReturnDirty(false); setReturnError(null); setReturnForm(emptyReturnForm(a.id)) }} className="p-1.5 text-[var(--text-4)] hover:text-primary-600 transition-colors" title="Return Asset">
        <Fa icon={faRotateLeft} />
      </button>
    ) : null
  }

  return (
    <div className="hr-submodule hr-assets flex flex-col">
      <div className="hr-submodule-toolbar p-4 border-b border-[var(--border-lt)] flex items-center justify-between bg-[var(--bg-surface)] gap-3">
        <div>
          <h3 className="text-sm font-bold text-[var(--text-1)]">Asset Assignments</h3>
          <p className="text-[11px] text-[var(--text-4)] mt-0.5">Staff equipment issued from trading stock. Office furniture and fittings are recorded under Property.</p>
        </div>
        {isAdmin && (
          <PrimaryActionButton icon={<Fa icon={faPlus} />} hideLabelOnMobile={false} onClick={openAssignModal}>
            Assign Asset
          </PrimaryActionButton>
        )}
      </div>

      <DataTable
        tableId="hr_assets"
        columns={assetColumns}
        rows={visibleAssignments}
        rowKey={a => a.id}
        emptyMessage="No assets assigned"
        emptyAction={<p className="text-xs text-[var(--text-4)] max-w-xs mx-auto mt-1">{canViewAllAssignments ? 'Track company property assigned to employees including laptops, phones, and tools.' : 'No company assets are currently assigned to you.'}</p>}
        rowActions={assetRowActions}
        exportTitle="Asset Assignments"
        exportFilename="asset-assignments"
      />

      {showAssignModal && (
        <Modal title="Assign Asset" subtitle="Issue company property to an employee and sync the assignment to the server" onClose={closeAssignModal} width={620}>
          <FormField label="Employee" required>
            <Select value={assignForm.employeeId} onChange={employeeId => updateAssign({ employeeId })} options={employeeOptions.length ? employeeOptions : [{ value: '', label: 'No active employees available' }]} />
          </FormField>
          <FormField label="Asset" required>
            <Select value={assignForm.productId} onChange={productId => updateAssign({ productId, serialId: '', qty: '1' })} options={productOptions.length ? productOptions : [{ value: '', label: 'No assignable stock available' }]} />
          </FormField>
          {selectedProduct?.requiresSerial ? (
            <FormField label="Serial Number" required>
              <Select value={assignForm.serialId} onChange={serialId => updateAssign({ serialId })} options={serialOptions.length ? serialOptions : [{ value: '', label: 'No available serials' }]} />
            </FormField>
          ) : (
            <FormField label="Quantity" required hint={selectedProduct ? `Available: ${selectedProduct.stockQty} ${selectedProduct.unit}` : undefined}>
              <Input type="number" value={assignForm.qty} onChange={qty => updateAssign({ qty })} />
            </FormField>
          )}
          <FormField label="Handover Condition">
            <Select value={assignForm.handoverCondition} onChange={handoverCondition => updateAssign({ handoverCondition: handoverCondition as EmployeeAssetAssignment['handoverCondition'] })} options={[{ value: 'new', label: 'New' }, { value: 'good', label: 'Good' }, { value: 'fair', label: 'Fair' }, { value: 'damaged', label: 'Damaged' }]} />
          </FormField>
          <FormField label="Handover Notes" hint="Record accessories or any condition notes given at handover.">
            <Textarea value={assignForm.handoverNotes} onChange={handoverNotes => updateAssign({ handoverNotes })} placeholder="Optional handover notes or accessories issued." />
          </FormField>
          {assignError && <div className="rounded-lg bg-[var(--danger-bg)] px-3 py-2 text-xs text-[var(--danger-text)]" role="alert">{assignError}</div>}
          <div className="hr-modal-actions flex justify-end gap-2 pt-2">
            <button className="btn-secondary px-4 py-2 text-xs" onClick={closeAssignModal}>Cancel</button>
            <AsyncActionButton action={submitAssign} pendingLabel="Saving…" className="btn-primary px-4 py-2 text-xs">
              Save Assignment
            </AsyncActionButton>
          </div>
        </Modal>
      )}

      {returnForm && isAdmin && (
        <Modal title="Return Asset" subtitle={selectedReturn ? `${selectedReturn.productName} assigned to ${selectedReturn.employeeName}` : undefined} onClose={closeReturnModal} width={520}>
          <FormField label="Return Location">
            <Select value={returnForm.returnLocation} onChange={returnLocation => updateReturn({ returnLocation: returnLocation as LocationId })} options={[{ value: 'warehouse', label: 'Warehouse' }, { value: 'shop', label: 'Shop' }, { value: 'repair_unit', label: 'Repair Unit' }]} />
          </FormField>
          <FormField label="Return Condition" required>
            <Select value={returnForm.condition} onChange={condition => updateReturn({ condition: condition as ReturnForm['condition'] })} options={[{ value: 'good', label: 'Good' }, { value: 'fair', label: 'Fair' }, { value: 'damaged', label: 'Damaged' }]} />
          </FormField>
          <FormField label="Inspection Notes" required error={returnError ?? undefined} hint="Record condition, missing accessories, or damage before returning stock.">
            <Textarea value={returnForm.notes} onChange={notes => updateReturn({ notes })} placeholder="Record the condition and any accessories returned." />
          </FormField>
          <div className="hr-modal-actions flex justify-end gap-2 pt-2">
            <button className="btn-secondary px-4 py-2 text-xs" onClick={closeReturnModal}>Cancel</button>
            <AsyncActionButton action={submitReturn} pendingLabel="Returning…" className="btn-primary px-4 py-2 text-xs">
              Confirm Return
            </AsyncActionButton>
          </div>
        </Modal>
      )}
    </div>
  )
}