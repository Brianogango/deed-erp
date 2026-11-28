'use client'
import { useEffect, useMemo, useState } from 'react'
import { useApp, fmtDate, type EmployeeAssetAssignment, type LocationId } from '@/lib/store'
import { useHrStore } from '@/hooks/useHrStore'
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard'
import { Input, Modal, Select, Textarea } from '@/components/ui'
import { AsyncActionButton, FormField } from '@/components/erp'
import { useCan } from '@/hooks/useCan'

type AssignForm = {
  employeeId: string
  productId: string
  serialId: string
  qty: string
  handoverCondition: EmployeeAssetAssignment['handoverCondition'] | ''
  handoverNotes: string
}

type ReturnForm = {
  assignmentId: string
  returnLocation: LocationId | ''
  condition: 'good' | 'fair' | 'damaged' | ''
  notes: string
}

const emptyAssignForm = (): AssignForm => ({
  employeeId: '',
  productId: '',
  serialId: '',
  qty: '',
  handoverCondition: '',
  handoverNotes: '',
})

const emptyReturnForm = (assignmentId = ''): ReturnForm => ({
  assignmentId,
  returnLocation: '',
  condition: '',
  notes: '',
})

export default function HRAssetsTab({ prefillEmployeeId, onPrefillUsed }: { prefillEmployeeId?: string | null; onPrefillUsed?: () => void } = {}) {
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
  const can = useCan()
  const isAdmin = can('manageHR')
  const canViewAllAssignments = can('viewHrRecords')
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

  const [assignForm, setAssignForm] = useState<AssignForm>(emptyAssignForm)
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
    setAssignForm(emptyAssignForm())
    setAssignDirty(false)
    setAssignError(null)
    setShowAssignModal(true)
  }

  // Opened from a person's checklist ("Issue equipment"): their name is already chosen.
  useEffect(() => {
    if (!prefillEmployeeId) return
    setAssignForm({ ...emptyAssignForm(), employeeId: prefillEmployeeId })
    setAssignDirty(false)
    setAssignError(null)
    setShowAssignModal(true)
    onPrefillUsed?.()
  }, [prefillEmployeeId]) // eslint-disable-line react-hooks/exhaustive-deps

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
    const missing: string[] = []
    if (!assignForm.employeeId) missing.push('Employee')
    if (!product) missing.push('Asset')
    if (product?.requiresSerial && !assignForm.serialId) missing.push('Serial Number')
    if (product && !product.requiresSerial && !assignForm.qty.trim()) missing.push('Quantity')
    if (!assignForm.handoverCondition) missing.push('Handover Condition')
    if (missing.length) { setAssignError(`Please fill in: ${missing.join(', ')}.`); return }
    if (!product || !assignForm.handoverCondition) return
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
    const missingReturn: string[] = []
    if (!returnForm.returnLocation) missingReturn.push('Return Location')
    if (!returnForm.condition) missingReturn.push('Return Condition')
    if (!returnForm.notes.trim()) missingReturn.push('Inspection Notes')
    if (missingReturn.length) { setReturnError(`Please fill in: ${missingReturn.join(', ')}.`); return }
    if (!returnForm.returnLocation || !returnForm.condition) return
    await Promise.resolve(returnEmployeeAsset(returnForm.assignmentId, returnForm.returnLocation, returnForm.condition, returnForm.notes.trim()))
    setReturnDirty(false)
    setReturnForm(null)
    showToast('Asset return recorded', 'success')
  }

  // HR mock D: scan the asset sticker, choose the person, Issue.
  const [scanCode, setScanCode] = useState('')
  const [scanTo, setScanTo] = useState('')
  const [scanMsg, setScanMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [issuedBy, setIssuedBy] = useState<'person' | 'item'>('person')
  const findSerial = (code: string) => {
    const c = code.trim().toUpperCase()
    if (!c) return undefined
    return serials.find(s => [s.serial, s.barcode, (s as { assetId?: string }).assetId].some(v => String(v ?? '').trim().toUpperCase() === c))
  }
  const issueByScan = async () => {
    const sn = findSerial(scanCode)
    if (!scanTo) { setScanMsg({ ok: false, text: 'Choose who it goes to.' }); return }
    if (!sn) { setScanMsg({ ok: false, text: `No machine with sticker or serial ${scanCode.trim() || '—'}.` }); return }
    if (sn.status !== 'available') { setScanMsg({ ok: false, text: `${sn.serial} is not in stock (${sn.status}).` }); return }
    await Promise.resolve(assignAssetToEmployee(scanTo, sn.productId, 1, sn.id, 'good', 'Issued by scanning its sticker'))
    const who = employees.find(e => e.id === scanTo)?.fullName ?? 'them'
    setScanMsg({ ok: true, text: `${sn.productName || 'Machine'} · ${sn.serial} issued to ${who}.` })
    setScanCode('')
  }
  const exitedIds = new Set(employees.filter(e => e.status === 'exited').map(e => e.id))
  const held = visibleAssignments.filter(a => a.status === 'assigned')
  const toCollect = held.filter(a => exitedIds.has(a.employeeId))
  const issued = held.filter(a => !exitedIds.has(a.employeeId))
    .sort((a, b) => issuedBy === 'person' ? a.employeeName.localeCompare(b.employeeName) : a.productName.localeCompare(b.productName))
  const leaverOf = (id: string) => employees.find(e => e.id === id)
  const color = (name: string) => { let h = 0; for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return ['#db2777', '#2563eb', '#0d9488', '#ea580c', '#7c3aed', '#0891b2', '#b45309', '#4f46e5'][h % 8] }
  const ini = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join('')
  const sinceLabel = (d: string) => new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })

  return (
    <div className="hrd">
      {isAdmin && (
        <section className="hrd-scan">
          <div className="hrd-scan-row">
            <input
              className="hrd-in hrd-code" value={scanCode} autoFocus placeholder="▣ Scan or type the asset ID (e.g. LT000312)…" aria-label="Asset ID"
              onChange={e => { setScanCode(e.target.value); setScanMsg(null) }}
              onKeyDown={e => { if (e.key === 'Enter') void issueByScan() }}
            />
            <select className="hrd-in hrd-to" value={scanTo} onChange={e => { setScanTo(e.target.value); setScanMsg(null) }} aria-label="Issue to">
              <option value="">To: choose person ▾</option>
              {activeEmployees.map(e => <option key={e.id} value={e.id}>{e.fullName}</option>)}
            </select>
            <button type="button" className="hrb-btn is-p" onClick={() => void issueByScan()}>Issue</button>
          </div>
          <p className={`hrd-note${scanMsg ? (scanMsg.ok ? ' is-ok' : ' is-bad') : ''}`}>
            {scanMsg?.text ?? 'The machine leaves stock and shows on their profile; they acknowledge it in My portal.'}
            {!scanMsg && <> · <button type="button" className="hrd-link" onClick={openAssignModal}>Something without a sticker?</button></>}
          </p>
        </section>
      )}

      {canViewAllAssignments && (
        <section className="hra-card">
          <div className="hra-ch"><b className="hrc-title">To collect · {toCollect.length}</b><span className="hrd-hint">leavers and expired loans</span></div>
          {toCollect.length === 0 ? <p className="hrb-empty">Nothing to collect — no one who left still holds company kit.</p> : (
            <div className="hra-table-wrap"><table className="hra-table"><tbody>
              {toCollect.map(a => {
                const e = leaverOf(a.employeeId)
                const future = !!e?.exitDate && e.exitDate > new Date().toISOString().slice(0, 10)
                return (
                  <tr key={a.id} className="is-static">
                    <td><div className="hra-who"><span className="hra-av" style={{ background: color(a.employeeName) }}>{ini(a.employeeName)}</span><b>{a.employeeName}</b></div></td>
                    <td>{a.productName}{a.serialNumber ? <> · <span className="hrd-mono">{a.serialNumber}</span></> : null}</td>
                    <td><span className="hra-chip is-r">{e?.exitDate ? `${future ? 'Leaves' : 'Left'} ${fmtDate(e.exitDate).replace(/ \d{4}$/, '')}` : 'Left'}</span></td>
                    <td className="hra-r">{isAdmin && <button type="button" className="hrb-btn" onClick={() => { setReturnDirty(false); setReturnError(null); setReturnForm(emptyReturnForm(a.id)) }}>Mark returned</button>}</td>
                  </tr>
                )
              })}
            </tbody></table></div>
          )}
        </section>
      )}

      <section className="hra-card">
        <div className="hra-ch">
          <b className="hrc-title">{canViewAllAssignments ? `Issued · ${issued.length}` : `Your equipment · ${issued.length}`}</b>
          {canViewAllAssignments && (
            <div className="hra-seg" role="tablist" aria-label="Group equipment">
              <button type="button" role="tab" aria-selected={issuedBy === 'person'} onClick={() => setIssuedBy('person')}>By person</button>
              <button type="button" role="tab" aria-selected={issuedBy === 'item'} onClick={() => setIssuedBy('item')}>By item</button>
            </div>
          )}
        </div>
        {issued.length === 0 ? <p className="hrb-empty">{canViewAllAssignments ? 'Nothing issued yet — scan a sticker above to issue a machine.' : 'No company equipment is assigned to you.'}</p> : (
          <div className="hra-table-wrap"><table className="hra-table">
            <thead><tr>{issuedBy === 'person' ? <><th>Person</th><th>Item</th></> : <><th>Item</th><th>Person</th></>}<th>Since</th><th>Acknowledged</th><th /></tr></thead>
            <tbody>
              {issued.map(a => {
                const item = <>{a.productName}{a.serialNumber ? <> · <span className="hrd-mono">{a.serialNumber}</span></> : null}</>
                return (
                  <tr key={a.id} className="is-static">
                    {issuedBy === 'person' ? <><td>{a.employeeName}</td><td>{item}</td></> : <><td>{item}</td><td>{a.employeeName}</td></>}
                    <td>{sinceLabel(a.assignedDate)}</td>
                    <td><span className={`hra-chip ${a.acknowledgedByEmployee ? 'is-g' : 'is-a'}`}>{a.acknowledgedByEmployee ? 'Yes' : 'Waiting'}</span></td>
                    <td className="hra-r">{isAdmin && <button type="button" className="hrd-link" onClick={() => { setReturnDirty(false); setReturnError(null); setReturnForm(emptyReturnForm(a.id)) }}>Return</button>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table></div>
        )}
      </section>

      {showAssignModal && (
        <Modal title="Assign Asset" subtitle="Issue company property to an employee and sync the assignment to the server" onClose={closeAssignModal} width={620}>
          <FormField label="Employee" required>
            <Select value={assignForm.employeeId} onChange={employeeId => updateAssign({ employeeId })} options={employeeOptions.length ? [{ value: '', label: 'Select employee…' }, ...employeeOptions] : [{ value: '', label: 'No active employees available' }]} />
          </FormField>
          <FormField label="Asset" required>
            <Select value={assignForm.productId} onChange={productId => updateAssign({ productId, serialId: '', qty: '' })} options={productOptions.length ? [{ value: '', label: 'Select asset…' }, ...productOptions] : [{ value: '', label: 'No assignable stock available' }]} />
          </FormField>
          {selectedProduct?.requiresSerial ? (
            <FormField label="Serial Number" required>
              <Select value={assignForm.serialId} onChange={serialId => updateAssign({ serialId })} options={serialOptions.length ? [{ value: '', label: 'Select serial…' }, ...serialOptions] : [{ value: '', label: 'No available serials' }]} />
            </FormField>
          ) : (
            <FormField label="Quantity" required hint={selectedProduct ? `Available: ${selectedProduct.stockQty} ${selectedProduct.unit}` : undefined}>
              <Input type="number" value={assignForm.qty} onChange={qty => updateAssign({ qty })} />
            </FormField>
          )}
          <FormField label="Handover Condition" required>
            <Select value={assignForm.handoverCondition} onChange={handoverCondition => updateAssign({ handoverCondition: handoverCondition as EmployeeAssetAssignment['handoverCondition'] })} options={[{ value: '', label: 'Select condition…' }, { value: 'new', label: 'New' }, { value: 'good', label: 'Good' }, { value: 'fair', label: 'Fair' }, { value: 'damaged', label: 'Damaged' }]} />
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
          <FormField label="Return Location" required>
            <Select value={returnForm.returnLocation} onChange={returnLocation => updateReturn({ returnLocation: returnLocation as LocationId })} options={[{ value: '', label: 'Select location…' }, { value: 'warehouse', label: 'Warehouse' }, { value: 'shop', label: 'Shop' }, { value: 'repair_unit', label: 'Repair Unit' }]} />
          </FormField>
          <FormField label="Return Condition" required>
            <Select value={returnForm.condition} onChange={condition => updateReturn({ condition: condition as ReturnForm['condition'] })} options={[{ value: '', label: 'Select condition…' }, { value: 'good', label: 'Good' }, { value: 'fair', label: 'Fair' }, { value: 'damaged', label: 'Damaged' }]} />
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