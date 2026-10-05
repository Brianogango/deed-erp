'use client'

import { useEffect, useMemo, useState } from 'react'
import { SalesDocField } from '@/components/modules/sales/workbench'
import { Field } from '@/components/ui'
import { AGENT_TAG } from '@/lib/agents/agent-commissions'

type ContactLike = { id: string; name: string; tags?: string[]; phone?: string }

export type AgentValue = { agentId?: string; agentName?: string; agentCommission?: number }

/**
 * Deed Express agent who brought the customer, and the commission agreed for
 * this sale (KES). The agent is paid once the customer has paid in full —
 * Finance → Agent commissions. Agents are contacts tagged deed_express_agent.
 */
export function AgentField({
  contacts,
  value,
  disabled,
  onChange,
  variant = 'sales',
}: {
  contacts: ContactLike[]
  value: AgentValue
  disabled?: boolean
  onChange: (next: AgentValue) => void
  variant?: 'sales' | 'compact'
}) {
  const [listed, setListed] = useState<ContactLike[]>([])
  useEffect(() => {
    let cancelled = false
    fetch('/api/agents/list', { cache: 'no-store' })
      .then(res => (res.ok ? res.json() : null))
      .then(body => { if (!cancelled && Array.isArray(body?.agents)) setListed(body.agents) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const agents = useMemo(() => {
    const list = [...listed]
    for (const c of contacts) {
      if (Array.isArray(c.tags) && c.tags.includes(AGENT_TAG) && !list.some(a => a.id === c.id)) list.push(c)
    }
    if (value.agentId && !list.some(a => a.id === value.agentId)) {
      list.unshift({ id: value.agentId, name: value.agentName || 'Current agent' })
    }
    return list.sort((a, b) => a.name.localeCompare(b.name))
  }, [listed, contacts, value.agentId, value.agentName])

  const [amount, setAmount] = useState(value.agentCommission ? String(value.agentCommission) : '')
  useEffect(() => {
    setAmount(value.agentCommission ? String(value.agentCommission) : '')
  }, [value.agentCommission])

  const commitAmount = () => {
    const next = Math.max(0, Math.round((Number(amount) || 0) * 100) / 100)
    if (next !== (value.agentCommission || 0)) onChange({ ...value, agentCommission: next })
  }

  const compact = variant === 'compact'
  const selectId = compact ? 'pos-agent' : 'sale-agent'
  const amountId = `${selectId}-commission`

  const select = (
    <select
      id={compact ? undefined : selectId}
      className={compact ? 'form-input text-xs' : undefined}
      aria-label="Deed Express agent who brought the customer"
      disabled={disabled}
      value={value.agentId || ''}
      onChange={e => {
        const agent = agents.find(a => a.id === e.target.value)
        onChange(agent
          ? { agentId: agent.id, agentName: agent.name, agentCommission: value.agentCommission || 0 }
          : { agentId: undefined, agentName: undefined, agentCommission: undefined })
      }}
    >
      <option value="">No agent</option>
      {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
    </select>
  )

  const amountInput = value.agentId ? (
    <input
      id={compact ? undefined : amountId}
      className={compact ? 'form-input text-xs' : undefined}
      type="number"
      min={0}
      inputMode="decimal"
      aria-label="Agreed agent commission in KES"
      placeholder="0"
      disabled={disabled}
      value={amount}
      onChange={e => setAmount(e.target.value)}
      onBlur={commitAmount}
    />
  ) : null

  if (agents.length === 0 && !value.agentId) return null

  if (compact) {
    return (
      <>
        <Field label="Brought by agent" id={selectId}>{select}</Field>
        {amountInput && <Field label="Agent commission (KES)" id={amountId}>{amountInput}</Field>}
      </>
    )
  }
  return (
    <>
      <SalesDocField label="Brought by agent" htmlFor={selectId}>{select}</SalesDocField>
      {amountInput && <SalesDocField label="Agent commission (KES)" htmlFor={amountId}>{amountInput}</SalesDocField>}
    </>
  )
}

/**
 * AgentField for a saved sale order: the agent lives in deed_saleAgents
 * (/api/agents/assign), not on the order row.
 */
export function SaleOrderAgentField({
  saleOrderId,
  contacts,
  disabled,
  onError,
}: {
  saleOrderId: string
  contacts: ContactLike[]
  disabled?: boolean
  onError: (message: string) => void
}) {
  const [value, setValue] = useState<AgentValue>({})
  useEffect(() => {
    let cancelled = false
    setValue({})
    fetch(`/api/agents/assign?saleOrderId=${encodeURIComponent(saleOrderId)}`, { cache: 'no-store' })
      .then(res => (res.ok ? res.json() : null))
      .then(body => {
        if (cancelled || !body?.agent) return
        setValue({ agentId: body.agent.agentId, agentName: body.agent.agentName, agentCommission: body.agent.agentCommission })
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [saleOrderId])

  const save = async (next: AgentValue) => {
    const previous = value
    setValue(next)
    try {
      const res = await fetch('/api/agents/assign', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ saleOrderId, agentId: next.agentId ?? '', agentCommission: next.agentCommission ?? 0 }),
      })
      const body = await res.json().catch(() => null) as { error?: string } | null
      if (!res.ok) throw new Error(body?.error || `server returned ${res.status}`)
    } catch (err) {
      setValue(previous)
      onError(`Could not save the agent: ${err instanceof Error ? err.message : 'error'}`)
    }
  }

  return <AgentField contacts={contacts} value={value} disabled={disabled} onChange={next => void save(next)} />
}
