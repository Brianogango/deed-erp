'use client'

import { useState } from 'react'
import { useApp, RepairOrder, fmtDate } from '@/lib/store'
import { Field, Input, Select, Textarea } from '@/components/ui'

const DEVICE_TYPES = [
  { id: 'laptop',  label: 'Laptop',   icon: '💻' },
  { id: 'desktop', label: 'Desktop',  icon: '🖥️' },
  { id: 'phone',   label: 'Phone',    icon: '📱' },
  { id: 'printer', label: 'Printer',  icon: '🖨️' },
  { id: 'other',   label: 'Other',    icon: '🔧' },
]

export default function RepairIntake({ onCancel, onSuccess }: { onCancel: () => void, onSuccess: (id: string) => void }) {
  const { contacts, warranties, createRepair, updateRepair, showToast } = useApp()

  const customers = contacts.filter(c => c.isCustomer)

  const [intake, setIntake] = useState({
    customerName: '', customerPhone: '', customerEmail: '',
    customerId: '',
    deviceType: 'laptop', customDeviceType: '',
    brand: '', model: '', serial: '',
    deviceCondition: 'good' as 'good' | 'fair' | 'poor' | 'damaged',
    accessories: '',
    issueDesc: '', priority: 'normal' as 'low' | 'normal' | 'high' | 'urgent',
    intakeChannel: 'walk_in' as 'walk_in' | 'website' | 'whatsapp' | 'call' | 'email' | 'rider_pickup',
    repairPath: 'diagnosis_first' as 'diagnosis_first' | 'direct_repair',
    estimatedCompletion: '',
    consentSignature: '',
    agreeTerms: false,
    clientCausedDamage: false,
    clientDamageReason: '',
  })
  const [createdTicket, setCreatedTicket] = useState<{ ref: string; id: string } | null>(null)

  const setI = (k: keyof typeof intake, v: string | boolean) =>
    setIntake(prev => ({ ...prev, [k]: v }))

  const matchedWarranty = intake.serial.trim().length >= 4
    ? warranties.find(w => w.serialNumber.toLowerCase() === intake.serial.trim().toLowerCase() && w.status === 'active')
    : undefined
  const intakeUnderWarranty = !!matchedWarranty && !intake.clientCausedDamage

  const handleCreateIntake = () => {
    if (!intake.customerName || !intake.customerPhone || !intake.brand || !intake.model) {
      showToast('Customer name, phone, device brand and model are required', 'error')
      return
    }
    if (intake.repairPath === 'direct_repair' && !intake.consentSignature.trim()) {
      showToast('Customer signature is required for direct repair consent', 'error')
      return
    }
    const matchedCustomer = customers.find(c =>
      c.name.toLowerCase() === intake.customerName.toLowerCase()
    )
    const customerId = matchedCustomer?.id ?? 'guest-' + Date.now()
    const customerName = intake.customerName
    const deviceTypeLabel = intake.deviceType === 'other' ? intake.customDeviceType || 'Other' : intake.deviceType
    const productLabel = `${intake.brand} ${intake.model}`.trim()
    
    const rep = createRepair(
      customerId, customerName,
      productLabel, intake.serial,
      intake.issueDesc
    )

    const accessories = intake.accessories
      .split(',').map(n => n.trim()).filter(Boolean)
      .map(name => ({ name, received: true }))

    updateRepair(rep.id, {
      customerPhone: intake.customerPhone,
      customerEmail: intake.customerEmail,
      intakeChannel: intake.intakeChannel as RepairOrder['intakeChannel'],
      deviceCondition: intake.deviceCondition,
      priority: intake.priority,
      repairPath: intake.repairPath,
      estimatedCompletionDate: intake.estimatedCompletion || undefined,
      accessories,
      underWarranty: intakeUnderWarranty,
      warrantyId: matchedWarranty?.id,
      clientCausedDamage: intake.clientCausedDamage || undefined,
      clientDamageReason: intake.clientCausedDamage ? intake.clientDamageReason || undefined : undefined,
      notes: intake.repairPath === 'direct_repair'
        ? `[Direct Repair Consent] Signed by: ${intake.consentSignature}. Device type: ${deviceTypeLabel}.`
        : `Device type: ${deviceTypeLabel}.`,
    })

    setIntake({
      customerName: '', customerPhone: '', customerEmail: '',
      customerId: '', deviceType: 'laptop', customDeviceType: '',
      brand: '', model: '', serial: '',
      deviceCondition: 'good', accessories: '',
      issueDesc: '', priority: 'normal', intakeChannel: 'walk_in',
      repairPath: 'diagnosis_first', estimatedCompletion: '',
      consentSignature: '', agreeTerms: false, clientCausedDamage: false, clientDamageReason: '',
    })

    setCreatedTicket({ ref: rep.ref, id: rep.id })
    showToast(`Ticket ${rep.ref} created — lead tech notified`)
  }

  return (
    <div className="flex flex-col" style={{ background: '#F4F6FA', height: '100dvh' }}>
      <div className="flex-shrink-0" style={{ background: 'linear-gradient(135deg, #1B2762 0%, #0D1B4B 100%)' }}>
        <div className="flex items-center gap-3 px-4 py-3.5">
          <button onClick={onCancel} style={{
            background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: 8, cursor: 'pointer', color: '#fff', fontSize: 16, lineHeight: 1,
            padding: '5px 9px', flexShrink: 0,
          }}>←</button>
          <div>
            <h2 className="text-sm font-bold text-white">New Device Intake</h2>
            <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.6)' }}>Register a new repair job</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 px-4 py-4 flex flex-col gap-4" style={{ WebkitOverflowScrolling: 'touch' }}>
        <div className="flex flex-col gap-4 w-full" style={{ maxWidth: 760, margin: '0 auto' }}>
          <div className="card p-4 flex flex-col gap-3">
            <div className="flex items-center gap-2 pb-2 border-b" style={{ borderColor: '#F3F4F6' }}>
              <div className="w-6 h-6 rounded-lg flex items-center justify-center text-xs flex-shrink-0" style={{ background: '#E8F3FA', color: '#1B2762' }}>1</div>
              <h3 className="text-sm font-semibold text-t1">Customer Information</h3>
            </div>
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
              <Field label="Full Name" required>
                <div className="relative">
                  <input className="form-input w-full" value={intake.customerName}
                    onChange={e => {
                      setI('customerName', e.target.value)
                      const m = customers.find(c => c.name.toLowerCase().startsWith(e.target.value.toLowerCase()))
                      if (m) setI('customerId', m.id)
                    }}
                    placeholder="Search customer..." list="customer-list" />
                  <datalist id="customer-list">
                    {customers.map(c => <option key={c.id} value={c.name} />)}
                  </datalist>
                </div>
              </Field>
              <Field label="Phone Number" required>
                <Input value={intake.customerPhone} onChange={v => setI('customerPhone', v)} placeholder="+254 7XX XXX XXX" />
              </Field>
              <Field label="Email Address">
                <Input value={intake.customerEmail} onChange={v => setI('customerEmail', v)} placeholder="customer@email.com" type="email" />
              </Field>
              <Field label="How did the device arrive?" hint="Optional">
                <Select value={intake.intakeChannel} onChange={v => setI('intakeChannel', v)}
                  options={[
                    { value: 'walk_in',      label: 'Walk-in' },
                    { value: 'rider_pickup', label: 'Rider Pickup' },
                  ]} />
              </Field>
            </div>
          </div>

          <div className="card p-4 flex flex-col gap-3">
            <div className="flex items-center gap-2 pb-2 border-b" style={{ borderColor: '#F3F4F6' }}>
              <div className="w-6 h-6 rounded-lg flex items-center justify-center text-xs flex-shrink-0" style={{ background: '#E8F3FA', color: '#1B2762' }}>2</div>
              <h3 className="text-sm font-semibold text-t1">Device Information</h3>
            </div>
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
              <Field label="Device Type" required>
                <Select value={intake.deviceType} onChange={v => setI('deviceType', v)}
                  options={DEVICE_TYPES.map(dt => ({ value: dt.id, label: `${dt.icon}  ${dt.label}` }))} />
              </Field>
              {intake.deviceType === 'other' && (
                <Field label="Specify Device Type" required>
                  <Input value={intake.customDeviceType} onChange={v => setI('customDeviceType', v)} placeholder="e.g. Smart TV, Scanner" />
                </Field>
              )}
              <Field label="Brand" required>
                <Input value={intake.brand} onChange={v => setI('brand', v)} placeholder="e.g. HP, Dell, Apple" />
              </Field>
              <Field label="Model" required>
                <Input value={intake.model} onChange={v => setI('model', v)} placeholder="e.g. ProBook 450, XPS 13" />
              </Field>
              <Field label="Serial / IMEI">
                <Input value={intake.serial} onChange={v => setI('serial', v)} placeholder="Device serial number" />
                {intake.serial.trim().length >= 4 && (
                  <div className="mt-1.5">
                    {matchedWarranty ? (
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg" style={{ background: '#ECFDF5', border: '1px solid #6EE7B7' }}>
                          <span style={{ fontSize: 13 }}>🛡️</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-[11px] font-semibold" style={{ color: '#065F46' }}>Under Warranty</p>
                            <p className="text-[10px]" style={{ color: '#047857' }}>{matchedWarranty.ref} · expires {fmtDate(matchedWarranty.endDate)}</p>
                          </div>
                          {intakeUnderWarranty && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: '#10B981', color: '#fff' }}>FREE</span>}
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg" style={{ background: '#F9FAFB', border: '1px solid #E5E7EB' }}>
                        <span style={{ fontSize: 12 }}>⚪</span>
                        <p className="text-[11px]" style={{ color: '#6B7280' }}>No active warranty found for this serial</p>
                      </div>
                    )}
                  </div>
                )}
              </Field>
              <Field label="Device Condition">
                <Select value={intake.deviceCondition} onChange={v => setI('deviceCondition', v)}
                  options={[
                    { value: 'good',    label: 'Good — No visible damage' },
                    { value: 'fair',    label: 'Fair — Minor scratches' },
                    { value: 'poor',    label: 'Poor — Visible damage' },
                    { value: 'damaged', label: 'Damaged — Severe damage' },
                  ]} />
              </Field>
              <Field label="Accessories" hint="Comma-separated">
                <Input value={intake.accessories} onChange={v => setI('accessories', v)} placeholder="charger, bag, mouse..." />
              </Field>
            </div>
          </div>

          <div className="card p-4 flex flex-col gap-3">
            <div className="flex items-center gap-2 pb-2 border-b" style={{ borderColor: '#F3F4F6' }}>
              <div className="w-6 h-6 rounded-lg flex items-center justify-center text-xs flex-shrink-0" style={{ background: '#E8F3FA', color: '#1B2762' }}>3</div>
              <h3 className="text-sm font-semibold text-t1">Problem Description</h3>
            </div>
            <Field label="Reported Issue" required>
              <Textarea value={intake.issueDesc} onChange={v => setI('issueDesc', v)} placeholder="Describe the problem as reported by the customer..." rows={3} />
            </Field>
            <div>
              <p className="text-[10px] uppercase tracking-[0.6px] font-medium text-t2 mb-2">Repair Path</p>
              <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
                {([
                  { value: 'diagnosis_first', icon: '🔍', title: 'Diagnosis First', desc: 'Technician diagnoses before deciding on repair. KES 1,500 if stopped at diagnosis.' },
                  { value: 'direct_repair',   icon: '🔧', title: 'Direct Repair',   desc: 'Skip diagnosis — proceed straight to repair work.' },
                ] as const).map(opt => (
                  <button key={opt.value} type="button" onClick={() => setI('repairPath', opt.value)}
                    style={{ textAlign: 'left', padding: '10px 12px', borderRadius: 10, cursor: 'pointer', transition: 'all 0.15s', background: intake.repairPath === opt.value ? '#E8F3FA' : '#F9FAFB', border: intake.repairPath === opt.value ? '2px solid #1B2762' : '1px solid #E5E7EB' }}>
                    <div className="flex items-center gap-2 mb-1">
                      <span style={{ fontSize: 15 }}>{opt.icon}</span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: intake.repairPath === opt.value ? '#1B2762' : '#374151' }}>{opt.title}</span>
                    </div>
                    <p style={{ fontSize: 10, color: '#6B7280', lineHeight: 1.4 }}>{opt.desc}</p>
                  </button>
                ))}
              </div>
            {intake.repairPath === 'direct_repair' && (
              <div className="mt-3 p-3 rounded-xl border" style={{ borderColor: '#C4B5FD', background: '#F5F3FF' }}>
                <Field label="Customer Consent Signature" required>
                  <Input value={intake.consentSignature} onChange={v => setI('consentSignature', v)} placeholder="Type customer's full name to sign" />
                </Field>
                <p className="text-[10px] text-gray-500 mt-1.5 leading-snug">
                  By providing this signature, the customer agrees to bypass the diagnosis phase and authorises the repair to proceed immediately.
                </p>
              </div>
            )}
            </div>
          </div>
          <div style={{ height: 16 }} />
        </div>
      </div>

      <div className="flex-shrink-0 px-4 py-3 flex items-center justify-between gap-3" style={{ background: '#FFFFFF', borderTop: '1px solid #E5E7EB', boxShadow: '0 -2px 8px rgba(0,0,0,0.06)' }}>
        <button className="btn-outline" onClick={onCancel}>Cancel</button>
        <button onClick={handleCreateIntake} style={{ padding: '11px 28px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#FFFFFF', border: 'none', transition: 'all 0.15s', background: 'linear-gradient(135deg, #1B2762, #00B0D7)', boxShadow: '0 2px 8px rgba(27,39,98,0.3)' }}>
          Create Ticket
        </button>
      </div>

      {createdTicket && (
        <div className="fixed inset-0 flex items-center justify-center" style={{ zIndex: 500, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}>
          <div className="w-full max-w-md mx-4 rounded-2xl overflow-hidden" style={{ background: '#fff', boxShadow: '0 24px 64px rgba(0,0,0,0.3)' }}>
            <div className="px-6 pt-6 pb-4 text-center" style={{ background: 'linear-gradient(135deg, #1B2762, #00B0D7)' }}>
              <div className="text-3xl mb-2">🎉</div>
              <h2 className="text-base font-bold text-white">Ticket Created!</h2>
              <p className="text-[11px] text-blue-100 mt-1">Lead tech has been notified</p>
            </div>
            <div className="px-6 py-5 flex flex-col gap-4">
              <div className="flex items-center justify-between rounded-xl px-4 py-3" style={{ background: '#F0F9FF', border: '1px solid #BAE6FD' }}>
                <span className="text-[10px] uppercase font-semibold" style={{ color: '#0369A1' }}>Ticket Ref</span>
                <span className="font-mono font-bold text-sm" style={{ color: '#1B2762' }}>{createdTicket.ref}</span>
              </div>
            </div>
            <div className="px-6 pb-5 flex flex-col sm:flex-row gap-3">
              <button className="flex-1 btn-outline text-xs py-2.5" onClick={() => { setCreatedTicket(null); onCancel() }}>
                Back to List
              </button>
              <button className="flex-1 btn-primary text-xs py-2.5" onClick={() => { setCreatedTicket(null); onSuccess(createdTicket.id) }}>
                Open Ticket →
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}