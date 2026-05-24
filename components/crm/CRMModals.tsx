'use client'

import { useState } from 'react'
import { useApp, LeadSource } from '@/lib/store'
import { Modal, Field, Input, Select, Textarea } from '@/components/ui'
import { LEAD_SOURCE_OPTIONS } from './crm-config'

export function CreateOpportunityModal({ onClose, onSuccess }: { onClose: () => void, onSuccess: (id: string) => void }) {
  const { clients, contactPersons, createOpportunity, showToast, currentUserId, users } = useApp()
  const currentUser = users.find(u => u.id === currentUserId)

  const [form, setForm] = useState({
    name: '', clientId: '', contactPersonId: '',
    expectedValue: '', expectedCloseDate: '', leadSource: 'website' as LeadSource,
    description: '',
  })

  const handleSubmit = () => {
    if (!form.name || !form.clientId) {
      showToast('Name and client are required', 'error')
      return
    }
    const opp = createOpportunity({
      name: form.name, clientId: form.clientId,
      contactPersonId: form.contactPersonId || undefined,
      assignedToId: currentUserId!,
      status: 'prospecting',
      probability: 10, expectedValue: Number(form.expectedValue) || 0,
      expectedCloseDate: form.expectedCloseDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      leadSource: form.leadSource, description: form.description,
    })
    onSuccess(opp.id)
  }

  return (
    <Modal title="Create Opportunity" onClose={onClose} width={720}>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Field label="Opportunity Name" required>
            <Input value={form.name} onChange={v => setForm(p => ({ ...p, name: v }))} placeholder="e.g., Q2 Laptop Refresh Project" />
          </Field>
        </div>
        <Field label="Client" required>
          <Select value={form.clientId} options={clients.map(c => ({ value: c.id, label: c.name }))}
            onChange={v => {
              setForm(p => ({ ...p, clientId: v, contactPersonId: '' })) // Reset contact person when company changes
            }} />
        </Field>
        <Field label="Contact Person">
          <Select value={form.contactPersonId}
            options={contactPersons.filter(cp => !form.clientId || cp.clientId === form.clientId).map(cp => ({ value: cp.id, label: `${cp.firstName} ${cp.lastName} (${cp.jobTitle})` }))}
            onChange={v => {
              setForm(p => ({ ...p, contactPersonId: v }))
            }} />
        </Field>
        <Field label="Expected Value (KES)">
          <Input type="number" value={form.expectedValue} onChange={v => setForm(p => ({ ...p, expectedValue: v }))} placeholder="0" />
        </Field>
        <Field label="Expected Close Date">
          <Input type="date" value={form.expectedCloseDate} onChange={v => setForm(p => ({ ...p, expectedCloseDate: v }))} />
        </Field>
        <Field label="Lead Source">
          <Select value={form.leadSource} options={LEAD_SOURCE_OPTIONS} onChange={v => setForm(p => ({ ...p, leadSource: v as LeadSource }))} />
        </Field>
        <div className="col-span-2">
          <Field label="Description" required>
            <Textarea value={form.description} onChange={v => setForm(p => ({ ...p, description: v }))} placeholder="Brief description of the opportunity..." />
          </Field>
        </div>

      </div>
      <div className="flex justify-end gap-2">
        <button className="btn-outline" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={handleSubmit}>Create Opportunity</button>
      </div>
    </Modal>
  )
}

export function CreateCompanyModal({ onClose, onSuccess }: { onClose: () => void, onSuccess: (id: string) => void }) {
  const { createCompany, showToast, currentUserId, users } = useApp()
  const currentUser = users.find(u => u.id === currentUserId)

  const [form, setForm] = useState({
        name: '', taxId: '', email: '', phone: '', website: '',
    physicalAddress: '', city: '', country: 'Kenya', paymentTerms: '30',
    creditLimit: '1000000',
  })

  const handleSubmit = () => {
    if (!form.name || !form.taxId || !form.email || !form.phone) {
      showToast('Name, tax ID, email, and phone are required', 'error')
      return
    }
    const comp = createCompany({
      name: form.name, taxId: form.taxId, email: form.email,
      phone: form.phone, website: form.website, physicalAddress: form.physicalAddress,
      city: form.city, country: form.country, paymentTerms: Number(form.paymentTerms) || 30,
      creditLimit: Number(form.creditLimit) || 0,
      status: 'active',
    })
    onSuccess(comp.id)
  }

  return (
    <Modal title="Add Company" onClose={onClose} width={720}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Company Name" required><Input value={form.name} onChange={v => setForm(p => ({ ...p, name: v }))} placeholder="ABC Corporation Ltd" /></Field>
        <Field label="Tax ID / PIN" required><Input value={form.taxId} onChange={v => setForm(p => ({ ...p, taxId: v }))} placeholder="P051234567A" /></Field>

        <Field label="Email" required><Input type="email" value={form.email} onChange={v => setForm(p => ({ ...p, email: v }))} placeholder="contact@company.com" /></Field>
        <Field label="Phone" required><Input value={form.phone} onChange={v => setForm(p => ({ ...p, phone: v }))} placeholder="+254 20 1234567" /></Field>
        <Field label="Website"><Input value={form.website} onChange={v => setForm(p => ({ ...p, website: v }))} placeholder="https://company.com" /></Field>
        <Field label="City"><Input value={form.city} onChange={v => setForm(p => ({ ...p, city: v }))} placeholder="Nairobi" /></Field>
        <div className="col-span-2">
          <Field label="Physical Address"><Textarea value={form.physicalAddress} onChange={v => setForm(p => ({ ...p, physicalAddress: v }))} placeholder="Street address, building, floor..." /></Field>
        </div>
        <Field label="Payment Terms (days)"><Input type="number" value={form.paymentTerms} onChange={v => setForm(p => ({ ...p, paymentTerms: v }))} /></Field>
        <Field label="Credit Limit (KES)"><Input type="number" value={form.creditLimit} onChange={v => setForm(p => ({ ...p, creditLimit: v }))} /></Field>

      </div>
      <div className="flex justify-end gap-2">
        <button className="btn-outline" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={handleSubmit}>Create Company</button>
      </div>
    </Modal>
  )
}

export function CreateContactModal({ onClose, onSuccess }: { onClose: () => void, onSuccess: () => void }) {
  const { clients, createContactPerson, showToast } = useApp()

  const [form, setForm] = useState({
    clientId: '', firstName: '', lastName: '', jobTitle: '',
    email: '', phone: '', mobile: '', isPrimary: false, isDecisionMaker: false,
    preferredChannel: 'email' as const,
    notes: '',
  })

  const handleSubmit = () => {
    if (!form.clientId || !form.firstName || !form.lastName || !form.email) {
      showToast("Client, name, and email are required", "error")
      return
    }
    createContactPerson({
      clientId: form.clientId, firstName: form.firstName,
      lastName: form.lastName, jobTitle: form.jobTitle,
      email: form.email, phone: form.phone, mobile: form.mobile, isPrimary: form.isPrimary,
      isDecisionMaker: form.isDecisionMaker, preferredChannel: form.preferredChannel,
      notes: form.notes,
    })
    onSuccess()
  }

  return (
    <Modal title="Add Contact Person" onClose={onClose} width={720}>
      <Field label="Client" required>
        <Select value={form.clientId} options={clients.map(c => ({ value: c.id, label: c.name }))}
          onChange={v => {
            setForm(p => ({ ...p, clientId: v }))
          }} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="First Name" required><Input value={form.firstName} onChange={v => setForm(p => ({ ...p, firstName: v }))} /></Field>
        <Field label="Last Name" required><Input value={form.lastName} onChange={v => setForm(p => ({ ...p, lastName: v }))} /></Field>
        <Field label="Job Title" required><Input value={form.jobTitle} onChange={v => setForm(p => ({ ...p, jobTitle: v }))} placeholder="e.g., IT Manager" /></Field>

        <Field label="Email" required><Input type="email" value={form.email} onChange={v => setForm(p => ({ ...p, email: v }))} /></Field>
        <Field label="Phone" required><Input value={form.phone} onChange={v => setForm(p => ({ ...p, phone: v }))} /></Field>
        <Field label="Mobile"><Input value={form.mobile} onChange={v => setForm(p => ({ ...p, mobile: v }))} /></Field>
        <Field label="Preferred Channel">
          <Select value={form.preferredChannel} onChange={v => setForm(p => ({ ...p, preferredChannel: v as any }))}
            options={[{ value: 'email', label: 'Email' }, { value: 'phone', label: 'Phone' }, { value: 'whatsapp', label: 'WhatsApp' }]} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3 mt-2">
        <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-1)' }}><input type="checkbox" checked={form.isPrimary} onChange={e => setForm(p => ({ ...p, isPrimary: e.target.checked }))} />Primary Contact</label>
        <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-1)' }}><input type="checkbox" checked={form.isDecisionMaker} onChange={e => setForm(p => ({ ...p, isDecisionMaker: e.target.checked }))} />Decision Maker</label>

      </div>

      <Field label="Notes"><Textarea value={form.notes} onChange={v => setForm(p => ({ ...p, notes: v }))} placeholder="Additional information..." /></Field>
      <div className="flex justify-end gap-2">
        <button className="btn-outline" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={handleSubmit}>Add Contact</button>
      </div>
    </Modal>
  )
}

export function LogActivityModal({ opportunityId, onClose, onSuccess }: { opportunityId: string, onClose: () => void, onSuccess: () => void }) {
  const { logActivity, showToast } = useApp()

  const [form, setForm] = useState({
    type: 'call' as 'call' | 'email' | 'meeting' | 'demo' | 'proposal' | 'note' | 'task',
    subject: '', description: '', outcome: '', scheduledDate: '', status: 'completed' as 'completed' | 'scheduled',
  })

  const handleSubmit = () => {
    if (!form.subject) { showToast('Subject is required', 'error'); return }
    logActivity({ opportunityId, ...form })
    onSuccess()
  }

  return (
    <Modal title="Log Activity" onClose={onClose} width={620}>
      <Field label="Activity Type">
        <Select value={form.type} onChange={v => setForm(p => ({ ...p, type: v as any }))}
          options={[{ value: 'call', label: 'Phone Call' }, { value: 'email', label: 'Email' }, { value: 'meeting', label: 'Meeting' }, { value: 'demo', label: 'Product Demo' }, { value: 'proposal', label: 'Proposal/Quote' }, { value: 'note', label: 'Note' }, { value: 'task', label: 'Task' }]} />
      </Field>
      <Field label="Subject" required><Input value={form.subject} onChange={v => setForm(p => ({ ...p, subject: v }))} placeholder="Brief summary of activity..." /></Field>
      <Field label="Description"><Textarea value={form.description} onChange={v => setForm(p => ({ ...p, description: v }))} placeholder="Detailed notes..." /></Field>
      <Field label="Outcome"><Textarea value={form.outcome} onChange={v => setForm(p => ({ ...p, outcome: v }))} placeholder="What was the result?" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Status">
          <Select value={form.status} onChange={v => setForm(p => ({ ...p, status: v as any }))}
            options={[{ value: 'completed', label: 'Completed' }, { value: 'scheduled', label: 'Scheduled' }]} />
        </Field>
        {form.status === 'scheduled' && (
          <Field label="Scheduled Date"><Input type="date" value={form.scheduledDate} onChange={v => setForm(p => ({ ...p, scheduledDate: v }))} /></Field>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <button className="btn-outline" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={handleSubmit}>Log Activity</button>
      </div>
    </Modal>
  )
}

export function MarkWonModal({ opportunityId, expectedValue, onClose, onSuccess }: { opportunityId: string, expectedValue: number, onClose: () => void, onSuccess: () => void }) {
  const { markOpportunityWon } = useApp()
  const [actualValue, setActualValue] = useState(String(expectedValue))

  return (
    <Modal title="Mark Opportunity as Won" onClose={onClose} width={480}>
      <Field label="Actual Deal Value (KES)" required>
        <Input type="number" value={actualValue} onChange={setActualValue} placeholder="Final deal amount" />
      </Field>
      <div className="text-xs p-3 rounded-lg" style={{ background: '#DCFCE7', color: '#059669' }}>
        This will move the opportunity to "Closed Won" and record the win date.
      </div>
      <div className="flex justify-end gap-2">
        <button className="btn-outline" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={() => { markOpportunityWon(opportunityId, Number(actualValue) || 0); onSuccess() }}>Mark as Won 🎉</button>
      </div>
    </Modal>
  )
}

export function MarkLostModal({ opportunityId, onClose, onSuccess }: { opportunityId: string, onClose: () => void, onSuccess: () => void }) {
  const { markOpportunityLost, showToast } = useApp()
  const [reason, setReason] = useState('')
  const [competitor, setCompetitor] = useState('')

  return (
    <Modal title="Mark Opportunity as Lost" onClose={onClose} width={480}>
      <Field label="Loss Reason" required>
        <Textarea value={reason} onChange={setReason} placeholder="Why was this opportunity lost?" />
      </Field>
      <Field label="Lost to Competitor (optional)">
        <Input value={competitor} onChange={setCompetitor} placeholder="Competitor name if known" />
      </Field>
      <div className="flex justify-end gap-2">
        <button className="btn-outline" onClick={onClose}>Cancel</button>
        <button className="btn-outline" style={{ color: '#F04438' }} onClick={() => {
          if (!reason) { showToast('Reason is required', 'error'); return }
          markOpportunityLost(opportunityId, reason, competitor)
          onSuccess()
        }}>Mark as Lost</button>
      </div>
    </Modal>
  )
}

export function CreateContractModal({ onClose, onSuccess }: { onClose: () => void, onSuccess: () => void }) {
  const { companies, contactPersons, createCustomerContract, showToast } = useApp()
  
  const [form, setForm] = useState({
    companyId: '', companyName: '', contactPersonId: '', contactPersonName: '',
    type: 'sales' as const, contractValue: '',
    startDate: new Date().toISOString().slice(0, 10),
    endDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    renewalDate: new Date(Date.now() + 335 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    noticePeriod: '30', paymentSchedule: 'monthly' as const, autoRenewal: false,
    slaTier: 'silver' as const, notes: '',
  })

  const handleSubmit = () => {
    if (!form.companyId || !form.contactPersonId || !form.contractValue) {
      showToast('Company, contact and contract value are required', 'error')
      return
    }
    const slaMap = {
      bronze: { response: 48, resolution: 120 }, silver: { response: 24, resolution: 72 },
      gold: { response: 4, resolution: 24 }, platinum: { response: 1, resolution: 8 },
    }
    const sla = slaMap[form.slaTier]

    createCustomerContract({
      companyId: form.companyId, companyName: form.companyName,
      contactPersonId: form.contactPersonId, contactPersonName: form.contactPersonName,
      type: form.type, contractValue: Number(form.contractValue),
      startDate: form.startDate, endDate: form.endDate, renewalDate: form.renewalDate,
      noticePeriod: Number(form.noticePeriod), paymentSchedule: form.paymentSchedule,
      autoRenewal: form.autoRenewal, slaTier: form.slaTier,
      responseTimeHours: sla.response, resolutionTimeHours: sla.resolution,
      status: 'active', saleOrderIds: [], invoiceIds: [], notes: form.notes,
    })
    onSuccess()
  }

  return (
    <Modal title="Create Customer Contract" onClose={onClose} width={720}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Company" required>
          <Select value={form.companyId} options={companies.map(c => ({ value: c.id, label: c.name }))}
            onChange={v => {
              const company = companies.find(c => c.id === v)
              setForm(p => ({ ...p, companyId: v, companyName: company?.name ?? '' }))
            }} />
        </Field>
        <Field label="Contact Person" required>
          <Select value={form.contactPersonId}
            options={contactPersons.filter(cp => !form.companyId || cp.companyId === form.companyId).map(cp => ({ value: cp.id, label: cp.fullName }))}
            onChange={v => {
              const cp = contactPersons.find(c => c.id === v)
              setForm(p => ({ ...p, contactPersonId: v, contactPersonName: cp?.fullName ?? '' }))
            }} />
        </Field>
        <Field label="Contract Type">
          <Select value={form.type} onChange={v => setForm(p => ({ ...p, type: v as any }))}
            options={[{ value: 'sales', label: 'Sales' }, { value: 'maintenance', label: 'Maintenance' }, { value: 'support', label: 'Support' }, { value: 'rental', label: 'Rental' }, { value: 'subscription', label: 'Subscription' }]} />
        </Field>
        <Field label="Contract Value (KES)" required>
          <Input type="number" value={form.contractValue} onChange={v => setForm(p => ({ ...p, contractValue: v }))} />
        </Field>
        <Field label="Start Date"><Input type="date" value={form.startDate} onChange={v => setForm(p => ({ ...p, startDate: v }))} /></Field>
        <Field label="End Date"><Input type="date" value={form.endDate} onChange={v => setForm(p => ({ ...p, endDate: v }))} /></Field>
        <Field label="Renewal Date"><Input type="date" value={form.renewalDate} onChange={v => setForm(p => ({ ...p, renewalDate: v }))} /></Field>
        <Field label="Notice Period (days)"><Input type="number" value={form.noticePeriod} onChange={v => setForm(p => ({ ...p, noticePeriod: v }))} /></Field>
        <Field label="Payment Schedule">
          <Select value={form.paymentSchedule} onChange={v => setForm(p => ({ ...p, paymentSchedule: v as any }))}
            options={[{ value: 'monthly', label: 'Monthly' }, { value: 'quarterly', label: 'Quarterly' }, { value: 'annual', label: 'Annual' }, { value: 'one-time', label: 'One-time' }]} />
        </Field>
        <Field label="SLA Tier">
          <Select value={form.slaTier} onChange={v => setForm(p => ({ ...p, slaTier: v as any }))}
            options={[{ value: 'bronze', label: 'Bronze (48h/120h)' }, { value: 'silver', label: 'Silver (24h/72h)' }, { value: 'gold', label: 'Gold (4h/24h)' }, { value: 'platinum', label: 'Platinum (1h/8h)' }]} />
        </Field>
        <div className="col-span-2">
          <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-1)' }}>
            <input type="checkbox" checked={form.autoRenewal} onChange={e => setForm(p => ({ ...p, autoRenewal: e.target.checked }))} /> Enable auto-renewal
          </label>
        </div>
        <div className="col-span-2">
          <Field label="Notes"><Textarea value={form.notes} onChange={v => setForm(p => ({ ...p, notes: v }))} placeholder="Contract notes" /></Field>
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <button className="btn-outline" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={handleSubmit}>Create Contract</button>
      </div>
    </Modal>
  )
}