'use client'

import { useState } from 'react'
import { Modal, Field, Input, Select, Textarea, Badge } from '@/components/ui'
import { fmtKes } from '@/lib/store'
import type { CustomerContract } from '@/lib/store'

interface ContractManagerProps {
  contracts: CustomerContract[]
  companyId?: string
  onCreateContract: (contract: Omit<CustomerContract, 'id' | 'ref'>) => void
  onRenewContract: (contractId: string, newEndDate: string) => void
  onTerminateContract: (contractId: string, reason: string) => void
}

const TIER_LABELS: Record<string, string> = {
  bronze: 'Bronze', silver: 'Silver', gold: 'Gold', platinum: 'Platinum',
}
const TIER_COLORS: Record<string, string> = {
  bronze: 'var(--warning)', silver: '#6B7280', gold: '#B45309', platinum: '#7C3AED',
}

export default function ContractManager({
  contracts, companyId, onCreateContract, onRenewContract, onTerminateContract,
}: ContractManagerProps) {
  const [showNewModal, setShowNewModal]           = useState(false)
  const [showRenewModal, setShowRenewModal]       = useState(false)
  const [showTerminateModal, setShowTerminateModal] = useState(false)
  const [selectedContractId, setSelectedContractId] = useState<string | null>(null)

  const [form, setForm] = useState({
    companyId: companyId ?? '',
    companyName: '',
    contactPersonId: '',
    contactPersonName: '',
    type: 'support' as CustomerContract['type'],
    startDate: new Date().toISOString().slice(0, 10),
    endDate: '',
    renewalDate: '',
    noticePeriod: '30',
    contractValue: '',
    paymentSchedule: 'monthly' as CustomerContract['paymentSchedule'],
    autoRenewal: true,
    slaTier: 'silver' as NonNullable<CustomerContract['slaTier']>,
    responseTimeHours: '4',
    resolutionTimeHours: '24',
    saleOrderIds: [] as string[],
    invoiceIds: [] as string[],
    notes: '',
  })

  const [renewForm,    setRenewForm]    = useState({ newEndDate: '', notes: '' })
  const [terminateForm, setTerminateForm] = useState({ reason: '' })
  const [formError, setFormError] = useState('')

  const filteredContracts = companyId
    ? contracts.filter(c => c.companyId === companyId)
    : contracts

  const activeContracts = filteredContracts.filter(c => c.status === 'active')
  const expiringContracts = filteredContracts.filter(c => {
    if (c.status !== 'active') return false
    const days = (new Date(c.endDate).getTime() - Date.now()) / 86400000
    return days < 30 && days > 0
  })

  const handleCreate = () => {
    if (!form.companyId || !form.companyName || !form.endDate || !form.contractValue) {
      setFormError('Please fill in all required fields'); return
    }
    setFormError('')
    onCreateContract({
      companyId: form.companyId,
      companyName: form.companyName,
      contactPersonId: form.contactPersonId,
      contactPersonName: form.contactPersonName,
      type: form.type,
      startDate: form.startDate,
      endDate: form.endDate,
      renewalDate: form.renewalDate || form.endDate,
      noticePeriod: parseInt(form.noticePeriod) || 30,
      contractValue: parseFloat(form.contractValue),
      paymentSchedule: form.paymentSchedule,
      autoRenewal: form.autoRenewal,
      slaTier: form.slaTier,
      responseTimeHours: parseInt(form.responseTimeHours) || 4,
      resolutionTimeHours: parseInt(form.resolutionTimeHours) || 24,
      status: 'active',
      saleOrderIds: [],
      invoiceIds: [],
      notes: form.notes,
    })
    setShowNewModal(false)
    resetForm()
  }

  const handleRenew = () => {
    if (!selectedContractId || !renewForm.newEndDate) { setFormError('Please select a new end date'); return }
    setFormError('')
    onRenewContract(selectedContractId, renewForm.newEndDate)
    setShowRenewModal(false); setSelectedContractId(null)
    setRenewForm({ newEndDate: '', notes: '' })
  }

  const handleTerminate = () => {
    if (!selectedContractId || !terminateForm.reason) { setFormError('Please provide a reason'); return }
    setFormError('')
    onTerminateContract(selectedContractId, terminateForm.reason)
    setShowTerminateModal(false); setSelectedContractId(null)
    setTerminateForm({ reason: '' })
  }

  const resetForm = () => setForm({
    companyId: companyId ?? '', companyName: '', contactPersonId: '', contactPersonName: '',
    type: 'support', startDate: new Date().toISOString().slice(0, 10), endDate: '',
    renewalDate: '', noticePeriod: '30', contractValue: '', paymentSchedule: 'monthly',
    autoRenewal: true, slaTier: 'silver', responseTimeHours: '4', resolutionTimeHours: '24',
    saleOrderIds: [], invoiceIds: [], notes: '',
  })

  return (
    <div className="flex flex-col gap-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="card p-4">
          <p className="text-2xl font-bold text-t1">{activeContracts.length}</p>
          <p className="text-xs text-t3 mt-1">Active Contracts</p>
        </div>
        <div className="card p-4">
          <p className="text-2xl font-bold" style={{ color: '#F59E0B' }}>{expiringContracts.length}</p>
          <p className="text-xs text-t3 mt-1">Expiring in 30 days</p>
        </div>
        <div className="card p-4">
          <p className="text-2xl font-bold text-t1">
            {fmtKes(activeContracts.reduce((s, c) => s + c.contractValue, 0))}
          </p>
          <p className="text-xs text-t3 mt-1">Total Contract Value</p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-semibold text-t1">Contracts</h3>
        <button className="btn-primary text-11" onClick={() => setShowNewModal(true)}>+ New Contract</button>
      </div>

      {/* Expiring Soon Alert */}
      {expiringContracts.length > 0 && (
        <div className="p-3 rounded-xl flex items-start gap-3" style={{ background: '#FEF3C7', border: '1px solid #FDE68A' }}>
          <span>⚠️</span>
          <div>
            <p className="text-xs font-semibold" style={{ color: 'var(--warning)' }}>
              {expiringContracts.length} Contract{expiringContracts.length > 1 ? 's' : ''} Expiring Soon
            </p>
            <p className="text-11" style={{ color: '#B45309' }}>Review and renew before they expire.</p>
          </div>
        </div>
      )}

      {/* Contracts List */}
      <div className="card overflow-hidden">
        {filteredContracts.length === 0 ? (
          <div className="py-12 text-center text-xs text-t3">No contracts found</div>
        ) : (
          filteredContracts.map(c => {
            const days = Math.ceil((new Date(c.endDate).getTime() - Date.now()) / 86400000)
            const expiring = c.status === 'active' && days < 30
            return (
              <div key={c.id} className="px-4 py-3 border-b hover:bg-gray-50 transition-colors" style={{ borderColor: 'var(--border-lt)' }}>
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-xs font-semibold text-t1">{c.companyName}</span>
                      <Badge status={c.status} />
                      {c.slaTier && (
                        <span style={{
                          fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 20,
                          background: TIER_COLORS[c.slaTier] + '18',
                          color: TIER_COLORS[c.slaTier],
                          border: `1px solid ${TIER_COLORS[c.slaTier]}40`,
                        }}>
                          {TIER_LABELS[c.slaTier]}
                        </span>
                      )}
                    </div>
                    <p className="text-10 text-t3 capitalize">{c.type.replace('_', ' ')} · {c.paymentSchedule}</p>
                  </div>
                  <div className="text-right flex-shrink-0 ml-4">
                    <p className="text-sm font-bold text-t1">{fmtKes(c.contractValue)}</p>
                    {expiring && <p className="text-10 mt-0.5" style={{ color: '#F59E0B' }}>Expires in {days}d</p>}
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-2 text-10 text-t3">
                  <span>Start: <strong className="text-t1">{c.startDate}</strong></span>
                  <span>End: <strong className="text-t1">{c.endDate}</strong></span>
                  {c.responseTimeHours != null && <span>Response: <strong className="text-t1">{c.responseTimeHours}h</strong></span>}
                  {c.resolutionTimeHours != null && <span>Resolution: <strong className="text-t1">{c.resolutionTimeHours}h</strong></span>}
                </div>
                {c.autoRenewal && <p className="text-10 mt-1" style={{ color: '#3B82F6' }}>↻ Auto-renewal enabled</p>}

                {c.status === 'active' && (
                  <div className="flex gap-3 mt-2">
                    <button className="text-10" style={{ color: '#3B82F6', background: 'none', border: 'none', cursor: 'pointer' }}
                      onClick={() => { setSelectedContractId(c.id); setShowRenewModal(true) }}>Renew</button>
                    <button className="text-10" style={{ color: '#EF4444', background: 'none', border: 'none', cursor: 'pointer' }}
                      onClick={() => { setSelectedContractId(c.id); setShowTerminateModal(true) }}>Terminate</button>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* New Contract Modal */}
      {showNewModal && (
        <Modal title="New Contract" onClose={() => setShowNewModal(false)} width={720}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Company ID" required>
              <Input value={form.companyId} onChange={v => setForm(p => ({ ...p, companyId: v }))} placeholder="COMP-001" />
            </Field>
            <Field label="Company Name" required>
              <Input value={form.companyName} onChange={v => setForm(p => ({ ...p, companyName: v }))} placeholder="Acme Corp" />
            </Field>
            <Field label="Contact Person">
              <Input value={form.contactPersonName} onChange={v => setForm(p => ({ ...p, contactPersonName: v }))} placeholder="Jane Doe" />
            </Field>
            <Field label="Contract Type" required>
              <Select value={form.type} onChange={v => setForm(p => ({ ...p, type: v as CustomerContract['type'] }))}
                options={[
                  { value: 'support', label: 'Support' },
                  { value: 'maintenance', label: 'Maintenance' },
                  { value: 'subscription', label: 'Subscription' },
                  { value: 'rental', label: 'Rental' },
                  { value: 'sales', label: 'Sales' },
                ]} />
            </Field>
            <Field label="Start Date" required>
              <input className="form-input" type="date" value={form.startDate}
                onChange={e => setForm(p => ({ ...p, startDate: e.target.value }))} />
            </Field>
            <Field label="End Date" required>
              <input className="form-input" type="date" value={form.endDate}
                onChange={e => setForm(p => ({ ...p, endDate: e.target.value }))} />
            </Field>
            <Field label="Contract Value (KES)" required>
              <Input type="number" value={form.contractValue} onChange={v => setForm(p => ({ ...p, contractValue: v }))} placeholder="500000" />
            </Field>
            <Field label="Payment Schedule">
              <Select value={form.paymentSchedule} onChange={v => setForm(p => ({ ...p, paymentSchedule: v as CustomerContract['paymentSchedule'] }))}
                options={[
                  { value: 'monthly', label: 'Monthly' },
                  { value: 'quarterly', label: 'Quarterly' },
                  { value: 'annual', label: 'Annual' },
                  { value: 'one-time', label: 'One-time' },
                ]} />
            </Field>
            <Field label="SLA Tier">
              <Select value={form.slaTier} onChange={v => setForm(p => ({ ...p, slaTier: v as NonNullable<CustomerContract['slaTier']> }))}
                options={[
                  { value: 'bronze', label: 'Bronze' },
                  { value: 'silver', label: 'Silver' },
                  { value: 'gold', label: 'Gold' },
                  { value: 'platinum', label: 'Platinum' },
                ]} />
            </Field>
            <Field label="Notice Period (days)">
              <Input type="number" value={form.noticePeriod} onChange={v => setForm(p => ({ ...p, noticePeriod: v }))} />
            </Field>
            <Field label="SLA Response Time (hours)">
              <Input type="number" value={form.responseTimeHours} onChange={v => setForm(p => ({ ...p, responseTimeHours: v }))} />
            </Field>
            <Field label="SLA Resolution Time (hours)">
              <Input type="number" value={form.resolutionTimeHours} onChange={v => setForm(p => ({ ...p, resolutionTimeHours: v }))} />
            </Field>
          </div>
          <Field label="Notes">
            <Textarea value={form.notes} onChange={v => setForm(p => ({ ...p, notes: v }))} rows={2} placeholder="Internal notes..." />
          </Field>
          <label className="flex items-center gap-2 mt-3 cursor-pointer">
            <input type="checkbox" checked={form.autoRenewal}
              onChange={e => setForm(p => ({ ...p, autoRenewal: e.target.checked }))}
              style={{ accentColor: 'var(--ink-navy)' }} />
            <span className="text-xs text-t2">Enable auto-renewal</span>
          </label>
          {formError && <p className="text-xs text-red-500 text-right">{formError}</p>}
          <div className="flex justify-end gap-2 mt-4">
            <button className="btn-outline" onClick={() => setShowNewModal(false)}>Cancel</button>
            <button className="btn-primary" onClick={handleCreate}>Create Contract</button>
          </div>
        </Modal>
      )}

      {/* Renew Modal */}
      {showRenewModal && (
        <Modal title="Renew Contract" onClose={() => setShowRenewModal(false)} width={420}>
          <Field label="New End Date" required>
            <input className="form-input" type="date" value={renewForm.newEndDate}
              onChange={e => setRenewForm(p => ({ ...p, newEndDate: e.target.value }))} />
          </Field>
          <Field label="Notes">
            <Textarea value={renewForm.notes} onChange={v => setRenewForm(p => ({ ...p, notes: v }))} rows={2} placeholder="Renewal notes..." />
          </Field>
          {formError && <p className="text-xs text-red-500 text-right">{formError}</p>}
          <div className="flex justify-end gap-2 mt-4">
            <button className="btn-outline" onClick={() => setShowRenewModal(false)}>Cancel</button>
            <button className="btn-primary" onClick={handleRenew}>Renew Contract</button>
          </div>
        </Modal>
      )}

      {/* Terminate Modal */}
      {showTerminateModal && (
        <Modal title="Terminate Contract" onClose={() => setShowTerminateModal(false)} width={420}>
          <div className="p-3 rounded text-xs mb-3" style={{ background: '#FEE2E2', border: '1px solid #FCA5A5', color: '#EF4444' }}>
            ⚠️ This action cannot be undone.
          </div>
          <Field label="Termination Reason" required>
            <Textarea value={terminateForm.reason} onChange={v => setTerminateForm(p => ({ ...p, reason: v }))}
              rows={3} placeholder="Reason for termination..." />
          </Field>
          {formError && <p className="text-xs text-red-500 text-right">{formError}</p>}
          <div className="flex justify-end gap-2 mt-4">
            <button className="btn-outline" onClick={() => setShowTerminateModal(false)}>Cancel</button>
            <button className="btn-primary" style={{ background: '#EF4444' }} onClick={handleTerminate}>Terminate</button>
          </div>
        </Modal>
      )}
    </div>
  )
}
