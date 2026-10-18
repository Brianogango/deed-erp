'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { PERMISSION_GROUPS } from '@/lib/auth/permission-catalog'
import { BUILT_IN_ROLE_LABELS, type AccessRole } from '@/lib/auth/access-roles'
import { MODULE_IDS, USER_ROLES, type ModuleId, type UserRole } from '@/lib/auth/types'
import { formatModuleLabel } from '@/lib/auth/access'

export type CustomRole = AccessRole & { userCount: number }
type RolesPayload = { builtIn: AccessRole[]; custom: CustomRole[] }

/** Custom roles for the user form and the editor. `null` until loaded. */
export function useAccessRoles(enabled: boolean) {
  const [data, setData] = useState<RolesPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const reload = useCallback(async () => {
    try {
      const res = await fetch('/api/access-roles', { cache: 'no-store' })
      const body = await res.json().catch(() => null) as (RolesPayload & { error?: string }) | null
      if (!res.ok || !body) throw new Error(body?.error || `Request failed (${res.status})`)
      setData(body); setError(null)
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not load roles') }
  }, [])
  useEffect(() => { if (enabled) void reload() }, [enabled, reload])
  return { data, error, reload }
}

type Draft = { id: string; name: string; description: string; baseRole: UserRole; modules: ModuleId[]; permissions: string[] }
const blank: Draft = { id: '', name: '', description: '', baseRole: 'sales_rep', modules: ['dashboard'], permissions: [] }

const BASE_ROLES = USER_ROLES.filter(r => r !== 'director')

export default function AccessRoles({ roles, canManage, onChanged }: { roles: RolesPayload | null; canManage: boolean; onChanged: () => void }) {
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ text: string; bad?: boolean } | null>(null)

  const modulesOn = useMemo(() => new Set(draft?.modules ?? []), [draft])

  const toggleModule = (m: ModuleId) => setDraft(d => d && ({
    ...d, modules: d.modules.includes(m) ? d.modules.filter(x => x !== m) : [...d.modules, m],
  }))
  const togglePermission = (key: string) => setDraft(d => d && ({
    ...d, permissions: d.permissions.includes(key) ? d.permissions.filter(x => x !== key) : [...d.permissions, key],
  }))
  const toggleGroup = (keys: string[], on: boolean) => setDraft(d => d && ({
    ...d, permissions: on ? Array.from(new Set([...d.permissions, ...keys])) : d.permissions.filter(k => !keys.includes(k)),
  }))

  const copyOf = (role: AccessRole) => setDraft({
    id: '', name: `${role.name} copy`, description: '', baseRole: role.baseRole === 'director' ? 'admin_officer' : role.baseRole,
    modules: [...role.modules], permissions: [...role.permissions],
  })

  const save = async () => {
    if (!draft) return
    setSaving(true); setMessage(null)
    try {
      const res = await fetch(draft.id ? `/api/access-roles/${draft.id}` : '/api/access-roles', {
        method: draft.id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: draft.name, description: draft.description, baseRole: draft.baseRole, modules: draft.modules, permissions: draft.permissions }),
      })
      const body = await res.json().catch(() => null) as { error?: string } | null
      if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`)
      setDraft(null); setMessage({ text: 'Role saved' }); onChanged()
    } catch (err) { setMessage({ text: err instanceof Error ? err.message : 'Could not save the role', bad: true }) }
    finally { setSaving(false) }
  }

  const remove = async (role: CustomRole) => {
    if (!window.confirm(`Delete the role “${role.name}”?`)) return
    const res = await fetch(`/api/access-roles/${role.id}`, { method: 'DELETE' })
    const body = await res.json().catch(() => null) as { error?: string } | null
    if (!res.ok) { setMessage({ text: body?.error || 'Could not delete the role', bad: true }); return }
    setMessage({ text: 'Role deleted' }); onChanged()
  }

  return (
    <div className="rounded-2xl border p-4 space-y-3" style={{ borderColor: 'var(--border-lt)', background: '#fff' }}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Roles</h3>
          <p className="text-[11px] text-gray-500 mt-0.5 max-w-xl">
            Build a role from the parts of each module a person needs, then give it to people from Edit user. “Server” items are refused by the server;
            “Screen” items hide the part from the menu and tabs.
          </p>
        </div>
        {canManage && !draft && <button className="btn-primary" onClick={() => setDraft({ ...blank })}>New role</button>}
      </div>
      {message && <p className="text-[11px] rounded-lg px-3 py-2" style={{ background: message.bad ? 'var(--danger-bg, #fee2e2)' : 'var(--success-bg, #dcfce7)' }} role="status">{message.text}</p>}

      {!draft && (
        <div className="space-y-2">
          {(roles?.custom ?? []).length === 0 && <p className="text-xs text-gray-500">No custom roles yet.</p>}
          {(roles?.custom ?? []).map(role => (
            <div key={role.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2" style={{ borderColor: 'var(--border-lt)' }}>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-gray-900">{role.name} <span className="font-normal text-gray-500">· {role.userCount} {role.userCount === 1 ? 'person' : 'people'}</span></p>
                <p className="text-[11px] text-gray-500 truncate">{role.description || `${role.modules.length} modules · ${role.permissions.length} permissions`}</p>
              </div>
              {canManage && (
                <div className="flex gap-1.5">
                  <button className="btn-outline" onClick={() => setDraft({ id: role.id, name: role.name, description: role.description, baseRole: role.baseRole, modules: [...role.modules], permissions: [...role.permissions] })}>Edit</button>
                  <button className="btn-outline" onClick={() => copyOf(role)}>Copy</button>
                  <button className="btn-outline" disabled={role.userCount > 0} title={role.userCount > 0 ? 'Move the people off this role first' : undefined} onClick={() => void remove(role)}>Delete</button>
                </div>
              )}
            </div>
          ))}
          <details className="text-xs">
            <summary className="cursor-pointer text-gray-600">Built-in roles (cannot be changed)</summary>
            <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
              {(roles?.builtIn ?? []).map(role => (
                <div key={role.id} className="flex items-center justify-between rounded-lg border px-3 py-2" style={{ borderColor: 'var(--border-lt)' }}>
                  <span>{role.name}</span>
                  {canManage && role.baseRole !== 'director' && <button className="btn-outline" onClick={() => copyOf(role)}>Copy as custom</button>}
                </div>
              ))}
            </div>
          </details>
        </div>
      )}

      {draft && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="text-xs">Role name
              <input className="mt-1 w-full rounded-lg border px-2 py-1.5 text-xs" value={draft.name} maxLength={60} onChange={e => setDraft({ ...draft, name: e.target.value })} />
            </label>
            <label className="text-xs">Works like (base role)
              <select className="mt-1 w-full rounded-lg border px-2 py-1.5 text-xs" value={draft.baseRole} onChange={e => setDraft({ ...draft, baseRole: e.target.value as UserRole })}>
                {BASE_ROLES.map(r => <option key={r} value={r}>{BUILT_IN_ROLE_LABELS[r]}</option>)}
              </select>
            </label>
            <label className="text-xs sm:col-span-2">Description (optional)
              <input className="mt-1 w-full rounded-lg border px-2 py-1.5 text-xs" value={draft.description} maxLength={200} onChange={e => setDraft({ ...draft, description: e.target.value })} />
            </label>
          </div>
          <p className="text-[11px] text-gray-500">
            The base role only decides which of a person’s own records they see (for example a sales rep’s own orders) and how screens not yet split into parts behave.
            Everything you tick below is what they can actually use.
          </p>

          <div>
            <p className="text-xs font-semibold mb-1">Modules they can open</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5">
              {MODULE_IDS.map(m => {
                const on = modulesOn.has(m)
                return (
                  <button key={m} type="button" onClick={() => toggleModule(m)} className="rounded-lg border px-2 py-1.5 text-left text-[11px]"
                    style={{ borderColor: on ? '#A8D4E8' : 'var(--border-lt)', background: on ? '#E8F3FA' : '#fff', fontWeight: on ? 600 : 400 }}>
                    {on ? '✓ ' : ''}{formatModuleLabel(m)}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-xs font-semibold">What they can do inside each module</p>
            {PERMISSION_GROUPS.map(group => {
              const keys = group.items.map(i => i.key)
              const closed = group.module ? !modulesOn.has(group.module) : false
              const all = keys.every(k => draft.permissions.includes(k))
              return (
                <fieldset key={group.id} className="rounded-xl border p-3" style={{ borderColor: 'var(--border-lt)', opacity: closed ? 0.5 : 1 }}>
                  <legend className="px-1 text-xs font-semibold">{group.label}{closed ? ' — module is off' : ''}</legend>
                  <label className="flex items-center gap-2 text-[11px] text-gray-600 mb-1">
                    <input type="checkbox" checked={all} disabled={closed} onChange={e => toggleGroup(keys, e.target.checked)} /> Select all
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                    {group.items.map(item => (
                      <label key={item.key} className="flex items-start gap-2 text-[11px]" title={item.hint}>
                        <input type="checkbox" className="mt-0.5" disabled={closed} checked={draft.permissions.includes(item.key)} onChange={() => togglePermission(item.key)} />
                        <span>
                          {item.label}
                          {item.sensitive && <span className="ml-1 text-amber-700" title="Shows money, cost, pay or personal data">●</span>}
                          <span className="ml-1 text-gray-400">{item.enforcement === 'server' ? 'Server' : 'Screen'}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              )
            })}
            <p className="text-[11px] text-gray-500"><span className="text-amber-700">●</span> shows money, cost, pay or personal data.</p>
          </div>

          <div className="flex justify-end gap-2">
            <button className="btn-outline" onClick={() => { setDraft(null); setMessage(null) }}>Cancel</button>
            <button className="btn-primary" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : draft.id ? 'Save role' : 'Create role'}</button>
          </div>
        </div>
      )}
    </div>
  )
}
