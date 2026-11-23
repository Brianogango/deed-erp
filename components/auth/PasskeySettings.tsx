'use client'

import { useCallback, useEffect, useState } from 'react'
import { addPasskey, isPasskeyCancel, passkeyLabel, passkeysSupported } from '@/lib/auth/passkey-client'

type Passkey = { id: string; name: string; createdAt: string; lastUsedAt: string | null }
type Toast = (msg: string, type?: 'success' | 'error' | 'info') => void

const fmt = (iso: string | null) => iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : 'never'

/**
 * Account → Face ID & fingerprint. Add this phone (password asked once), see
 * the devices that can sign you in, remove one you no longer have.
 */
export default function PasskeySettings({ showToast }: { showToast: Toast }) {
  const [list, setList] = useState<Passkey[] | null>(null)
  const [label, setLabel] = useState('passkey')
  const [supported, setSupported] = useState(false)
  const [adding, setAdding] = useState(false)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/passkey', { cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      setList(res.ok && Array.isArray(data.passkeys) ? data.passkeys : [])
    } catch { setList([]) }
  }, [])

  useEffect(() => {
    setSupported(passkeysSupported())
    setLabel(passkeyLabel())
    void load()
  }, [load])

  const add = async () => {
    if (!password || busy) return
    setBusy(true)
    try {
      const { name } = await addPasskey(password)
      setAdding(false)
      setPassword('')
      showToast(`${label === 'passkey' ? 'Passkey' : label === 'fingerprint' ? 'Fingerprint' : label} sign-in is on for this ${name}.`, 'success')
      void load()
    } catch (error) {
      if (!isPasskeyCancel(error)) showToast(error instanceof Error ? error.message : 'Could not add it', 'error')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (p: Passkey) => {
    if (!window.confirm(`Remove ${p.name}? It will no longer sign you in.`)) return
    const res = await fetch(`/api/auth/passkey?id=${encodeURIComponent(p.id)}`, { method: 'DELETE' })
    if (res.ok) { showToast(`${p.name} removed`, 'info'); void load() }
    else showToast('Could not remove it', 'error')
  }

  return (
    <div className="passkey-settings">
      {list && list.length > 0 && (
        <ul className="passkey-settings__list">
          {list.map(p => (
            <li key={p.id}>
              <span>
                <b>{p.name}</b>
                <small>Added {fmt(p.createdAt)} · last used {fmt(p.lastUsedAt)}</small>
              </span>
              <button type="button" onClick={() => void remove(p)}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      {list && list.length === 0 && (
        <p className="passkey-settings__empty">Sign in with your face or fingerprint instead of typing your password. It stays on your phone; the ERP never sees it.</p>
      )}
      {!supported ? (
        <p className="passkey-settings__empty">This browser cannot use {label}. On an iPhone use Safari or the Home Screen app; on Android, Chrome.</p>
      ) : adding ? (
        <div className="passkey-settings__add">
          <label>
            <span>Your password, to confirm it is you</span>
            <input type="password" className="form-input" autoComplete="current-password" value={password}
              onChange={e => setPassword(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void add() }} autoFocus />
          </label>
          <div>
            <button type="button" className="passkey-settings__cancel" onClick={() => { setAdding(false); setPassword('') }} disabled={busy}>Cancel</button>
            <button type="button" className="passkey-settings__go" onClick={() => void add()} disabled={!password || busy}>{busy ? 'Waiting for your phone…' : 'Continue'}</button>
          </div>
        </div>
      ) : (
        <button type="button" className="passkey-settings__go" onClick={() => setAdding(true)}>
          Add {label === 'passkey' ? 'a passkey' : label} on this device
        </button>
      )}
    </div>
  )
}
