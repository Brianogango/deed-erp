'use client'

import { useCallback, useEffect, useState } from 'react'
import { Field, Input } from '@/components/ui'

type Threshold = { maxValue: number; requiredRoles: string[] }
type ApprovalRule = {
  id?: string
  approvalType: string
  thresholds: Threshold[]
  isActive: boolean
}

const TYPE_LABELS: Record<string, { label: string; unit: string; hint: string }> = {
  discount: { label: 'Discount %', unit: '%', hint: 'Ladder by discount percent. Empty roles = auto-approve.' },
  credit_override: { label: 'Credit overage (KES)', unit: 'KES', hint: 'Amount above available credit.' },
  backorder: { label: 'Backorder qty', unit: 'units', hint: 'Units short against on-hand stock.' },
  special_pricing: { label: 'Special pricing', unit: '', hint: 'Kept. Confirm is on hold unless Settings → Require approval below lowest selling point is on.' },
  corporate_deal: { label: 'Corporate deal', unit: '', hint: 'Always requires listed roles when active.' },
  expense: { label: 'Expense claims', unit: 'KES', hint: 'Sequential approvers by claim amount (finance_officer, then director above threshold).' },
}

const ROLE_OPTIONS = ['director', 'finance_officer', 'technical_lead', 'admin_officer', 'sales_rep']

function SettingRow({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start justify-between py-3.5 border-b border-gray-50 last:border-0 gap-3 sm:gap-4">
      <div className="flex-1 min-w-0">
        <p className="text-[12.5px] font-semibold text-gray-800 leading-tight">{label}</p>
        {desc && <p className="text-[11px] text-gray-400 mt-0.5 leading-relaxed">{desc}</p>}
      </div>
      <div className="flex-shrink-0 w-full sm:w-[340px]">{children}</div>
    </div>
  )
}

export default function ApprovalRulesEditor({
  canWrite,
  showToast,
}: {
  canWrite: boolean
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void
}) {
  const [rules, setRules] = useState<ApprovalRule[]>([])
  const [loading, setLoading] = useState(true)
  const [savingType, setSavingType] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/settings/approval-rules')
      if (!res.ok) throw new Error('Failed to load')
      const data = await res.json()
      setRules(Array.isArray(data) ? data : [])
    } catch {
      setRules([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const updateLocal = (approvalType: string, patch: Partial<ApprovalRule>) => {
    setRules(prev => prev.map(r => r.approvalType === approvalType ? { ...r, ...patch } : r))
  }

  const updateThreshold = (approvalType: string, index: number, patch: Partial<Threshold>) => {
    setRules(prev => prev.map(r => {
      if (r.approvalType !== approvalType) return r
      const thresholds = [...(r.thresholds || [])]
      thresholds[index] = { ...thresholds[index], ...patch }
      return { ...r, thresholds }
    }))
  }

  const save = async (rule: ApprovalRule) => {
    if (!canWrite) {
      showToast('Only Director or Finance can change approval thresholds', 'error')
      return
    }
    setSavingType(rule.approvalType)
    try {
      const res = await fetch('/api/settings/approval-rules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          approvalType: rule.approvalType,
          thresholds: rule.thresholds,
          isActive: rule.isActive,
        }),
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => null)
        throw new Error(payload?.error || 'Save failed')
      }
      const saved = await res.json()
      setRules(prev => prev.map(r => r.approvalType === saved.approvalType ? saved : r))
      showToast(`Saved ${rule.approvalType} thresholds`)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Save failed', 'error')
    } finally {
      setSavingType(null)
    }
  }

  if (loading) {
    return <p className="text-[12px] text-gray-400 py-3">Loading approval rules…</p>
  }

  if (rules.length === 0) {
    return (
      <p className="text-[12px] text-gray-400 py-3">
        No DB rules yet — hardcoded fallbacks apply until you run the accounting foundation migration and backfill.
      </p>
    )
  }

  return (
    <div>
      {rules.filter(rule => rule.approvalType !== 'purchase_high_value').map(rule => {
        const meta = TYPE_LABELS[rule.approvalType] || { label: rule.approvalType, unit: '', hint: '' }
        return (
          <SettingRow key={rule.approvalType} label={meta.label} desc={meta.hint}>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-[11px] text-gray-600">
                <input
                  type="checkbox"
                  checked={rule.isActive}
                  disabled={!canWrite}
                  onChange={e => updateLocal(rule.approvalType, { isActive: e.target.checked })}
                />
                Active (unchecked = use hardcoded fallback)
              </label>
              {(rule.thresholds || []).map((t, i) => (
                <div key={i} className="grid grid-cols-2 gap-2">
                  <Field label={`Max ${meta.unit || 'value'}`}>
                    <Input
                      type="number"
                      value={String(t.maxValue)}
                      disabled={!canWrite}
                      onChange={v => updateThreshold(rule.approvalType, i, { maxValue: Number(v) || 0 })}
                    />
                  </Field>
                  <Field label="Roles (comma)">
                    <Input
                      value={(t.requiredRoles || []).join(', ')}
                      disabled={!canWrite}
                      onChange={v => updateThreshold(rule.approvalType, i, {
                        requiredRoles: v.split(',').map(s => s.trim()).filter(Boolean).filter(r => ROLE_OPTIONS.includes(r) || r.length > 0),
                      })}
                    />
                  </Field>
                </div>
              ))}
              {canWrite && (
                <button
                  type="button"
                  disabled={savingType === rule.approvalType}
                  onClick={() => void save(rule)}
                  className="text-[11px] px-3 py-1.5 bg-navy-500 hover:bg-navy-600 disabled:opacity-50 text-white border-none rounded-lg cursor-pointer font-semibold"
                >
                  {savingType === rule.approvalType ? 'Saving…' : 'Save'}
                </button>
              )}
            </div>
          </SettingRow>
        )
      })}
    </div>
  )
}
