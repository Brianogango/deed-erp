'use client'
import { useMemo, useState } from 'react'
import { useApp, fmtDate, type EmployeeAssetAssignment, type LocationId } from '@/lib/store'
import { useHrStore } from '@/hooks/useHrStore'
import { Fa } from '@/components/icons'
import { faLaptop, faPlus, faRotateLeft, faCheckCircle, faClock } from '@fortawesome/free-solid-svg-icons'
import { Field, Input, Modal, Select, Textarea } from '@/components/ui'
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

  const openAssignModal = () => {
    setAssignForm(emptyAssignForm(activeEmployees[0]?.id ?? '', assignableProducts[0]?.id ?? ''))
    setShowAssignModal(true)
  }

  const submitAssign = () => {
    const product = assignableProducts.find(p => p.id === assignForm.productId)
    const qty = product?.requiresSerial ? 1 : Number(assignForm.qty)
    if (!assignForm.employeeId) { showToast('Select an employee for the asset assignment', 'error'); return }
    if (!product) { showToast('Select an available asset to assign', 'error'); return }
    if (product.requiresSerial && !assignForm.serialId) { showToast('Select the serial number being assigned', 'error'); return }
    if (!product.requiresSerial && (!Number.isFinite(qty) || qty <= 0)) { showToast('Quantity must be greater than zero', 'error'); return }
    if (!product.requiresSerial && qty > product.stockQty) { showToast('Quantity exceeds available stock', 'error'); return }

    assignAssetToEmployee(
      assignForm.employeeId,
      product.id,
      qty,
      product.requiresSerial ? assignForm.serialId : undefined,
      assignForm.handoverCondition,
      assignForm.handoverNotes.trim()
    )
    setShowAssignModal(false)
  }

  const submitReturn = () => {
    if (!returnForm) return
    if (!returnForm.assignmentId) { showToast('Select an asset assignment to return', 'error'); return }
    if (!returnForm.notes.trim()) { showToast('Return inspection notes are required', 'error'); return }
    returnEmployeeAsset(returnForm.assignmentId, returnForm.returnLocation, returnForm.condition, returnForm.notes.trim())
    setReturnForm(null)
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
        <div className="flex items-center gap-1.5">
          {a.status === 'assigned' ? (
            <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">
              <Fa icon={faClock} className="text-[8px]" />
              ASSIGNED
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-50 text-green-700">
              <Fa icon={faCheckCircle} className="text-[8px]" />
              RETURNED
            </span>
          )}
          {a.acknowledgedByEmployee && (
            <span className="text-[8px] font-black text-green-600">ACKNOWLEDGED</span>
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
      <button onClick={e => { e.stopPropagation(); setReturnForm(emptyReturnForm(a.id)) }} className="p-1.5 text-[var(--text-4)] hover:text-primary-600 transition-colors" title="Return Asset">
        <Fa icon={faRotateLeft} />
      </button>
    ) : null
  }

  return (
    <div className="flex flex-col">
      <div className="p-4 border-b border-[var(--border-lt)] flex items-center justify-between bg-[var(--bg-surface)]">
        <h3 className="text-sm font-bold text-[var(--text-1)]">Asset Assignments</h3>
        {isAdmin && (
          <button onClick={openAssignModal} className="btn-primary py-1.5 px-4 text-[10px] flex items-center gap-2">
            <Fa icon={faPlus} />
            <span>Assign Asset</span>
          </button>
        )}
      </div>

      <DataTable
        tableId="hr_assets"
        columns={assetColumns}
        rows={visibleAssignments}
        rowKey={a => a.id}
        emptyMessage="No Assets Assigned"
        emptyAction={<p className="text-xs text-[var(--text-4)] max-w-xs mx-auto mt-1">{canViewAllAssignments ? 'Track company property assigned to employees including laptops, phones, and tools.' : 'No company assets are currently assigned to you.'}</p>}
        rowActions={assetRowActions}
        exportTitle="Asset Assignments"
        exportFilename="asset-assignments"
      />

      {showAssignModal && (
        <Modal title="Assign Asset" subtitle="Issue company property to an employee and sync the assignment to the server" onClose={() => setShowAssignModal(false)} width={620}>
          <Field label="Employee" required><Select value={assignForm.employeeId} onChange={employeeId => setAssignForm(p => ({ ...p, employeeId }))} options={employeeOptions.length ? employeeOptions : [{ value: '', label: 'No active employees available' }]} /></Field>
          <Field label="Asset" required><Select value={assignForm.productId} onChange={productId => setAssignForm(p => ({ ...p, productId, serialId: '', qty: '1' }))} options={productOptions.length ? productOptions : [{ value: '', label: 'No assignable stock available' }]} /></Field>
          {selectedProduct?.requiresSerial ? (
            <Field label="Serial Number" required><Select value={assignForm.serialId} onChange={serialId => setAssignForm(p => ({ ...p, serialId }))} options={serialOptions.length ? serialOptions : [{ value: '', label: 'No available serials' }]} /></Field>
          ) : (
            <Field label="Quantity" required hint={selectedProduct ? `Available: ${selectedProduct.stockQty} ${selectedProduct.unit}` : undefined}><Input type="number" value={assignForm.qty} onChange={qty => setAssignForm(p => ({ ...p, qty }))} /></Field>
          )}
          <Field label="Handover Condition"><Select value={assignForm.handoverCondition} onChange={handoverCondition => setAssignForm(p => ({ ...p, handoverCondition: handoverCondition as EmployeeAssetAssignment['handoverCondition'] }))} options={[{ value: 'new', label: 'New' }, { value: 'good', label: 'Good' }, { value: 'fair', label: 'Fair' }, { value: 'damaged', label: 'Damaged' }]} /></Field>
          <Field label="Handover Notes"><Textarea value={assignForm.handoverNotes} onChange={handoverNotes => setAssignForm(p => ({ ...p, handoverNotes }))} placeholder="Optional handover notes or accessories issued." /></Field>
          <div className="flex justify-end gap-2 pt-2">
            <button className="btn-secondary px-4 py-2 text-xs" onClick={() => setShowAssignModal(false)}>Cancel</button>
            <button className="btn-primary px-4 py-2 text-xs" onClick={submitAssign}>Save Assignment</button>
          </div>
        </Modal>
      )}

      {returnForm && isAdmin && (
        <Modal title="Return Asset" subtitle={selectedReturn ? `${selectedReturn.productName} assigned to ${selectedReturn.employeeName}` : undefined} onClose={() => setReturnForm(null)} width={520}>
          <Field label="Return Location"><Select value={returnForm.returnLocation} onChange={returnLocation => setReturnForm(p => p ? ({ ...p, returnLocation: returnLocation as LocationId }) : p)} options={[{ value: 'warehouse', label: 'Warehouse' }, { value: 'shop', label: 'Shop' }, { value: 'repair_unit', label: 'Repair Unit' }]} /></Field>
          <Field label="Return Condition" required><Select value={returnForm.condition} onChange={condition => setReturnForm(p => p ? ({ ...p, condition: condition as ReturnForm['condition'] }) : p)} options={[{ value: 'good', label: 'Good' }, { value: 'fair', label: 'Fair' }, { value: 'damaged', label: 'Damaged' }]} /></Field>
          <Field label="Inspection Notes" required><Textarea value={returnForm.notes} onChange={notes => setReturnForm(p => p ? ({ ...p, notes }) : p)} placeholder="Record the condition and any accessories returned." /></Field>
          <div className="flex justify-end gap-2 pt-2">
            <button className="btn-secondary px-4 py-2 text-xs" onClick={() => setReturnForm(null)}>Cancel</button>
            <button className="btn-primary px-4 py-2 text-xs" onClick={submitReturn}>Confirm Return</button>
          </div>
        </Modal>
      )}
    </div>
  )
}
