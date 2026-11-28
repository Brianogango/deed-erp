'use client'

import { useCallback, useEffect, useState } from 'react'
import PasskeySettings from '@/components/auth/PasskeySettings'
import { startAuthentication, WebAuthnAbortService } from '@simplewebauthn/browser'
import { isPasskeyCancel, passkeyLabel, passkeysSupported } from '@/lib/auth/passkey-client'
import { hoursBetween, payableValue, type AttendanceDay } from '@/lib/hr/attendance-core'

type Me = {
  employee: { id: string; name: string } | null
  today: AttendanceDay | null
  inOffice: boolean
  officeNetworksSet: boolean
  hasPasskey: boolean
  month?: { worked: number; of: number }
}

const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Nairobi' }) : '')

async function postJson(url: string, body?: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || data.message || 'Something went wrong')
  return data
}

/**
 * Clock in / clock out for the signed-in person. The phone's Face ID or
 * fingerprint confirms who it is; the connection says whether it is the office.
 * Anything short of both still records the day, for a supervisor to approve.
 */
export default function ClockCard({ showToast, variant = 'card', firstName = '', onMonth }: {
  showToast?: (msg: string, type?: 'success' | 'error' | 'info') => void
  /** 'hero': the My portal band (HR mock H) — date, greeting, big clock and the button. */
  variant?: 'card' | 'hero'
  firstName?: string
  /** This month's days, for the portal's "Days worked" ring. */
  onMonth?: (m: { worked: number; of: number }) => void
}) {
  const [me, setMe] = useState<Me | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [setup, setSetup] = useState(false)
  const [, tick] = useState(0)
  const label = passkeyLabel()

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/attendance/me', { cache: 'no-store' })
      if (res.ok) { const d = await res.json(); setMe(d); if (d?.month) onMonth?.(d.month) }
    } catch { /* offline: keep what is shown */ }
  }, [])
  useEffect(() => { void load() }, [load])
  useEffect(() => { const t = setInterval(() => tick(n => n + 1), 60_000); return () => clearInterval(t) }, [])

  if (!me) return null
  const day = me.today
  const action: 'in' | 'out' | null = !day?.clockIn ? 'in' : !day.clockOut ? 'out' : null

  const punch = async () => {
    if (!action) return
    setBusy(true)
    setError('')
    try {
      let response: unknown
      if (me.hasPasskey && passkeysSupported()) {
        WebAuthnAbortService.cancelCeremony()
        const { options } = await postJson('/api/attendance/clock/options')
        if (options) response = await startAuthentication({ optionsJSON: options })
      }
      const { day: fresh } = await postJson('/api/attendance/clock', { action, response })
      setMe(m => (m ? { ...m, today: fresh } : m))
      const msg = action === 'in' ? `Clocked in at ${time(fresh.clockIn)}` : `Clocked out at ${time(fresh.clockOut)}`
      showToast?.(fresh.status === 'approved' ? msg : `${msg} — a supervisor will confirm it`, fresh.status === 'approved' ? 'success' : 'info')
      void load()
    } catch (e) {
      if (isPasskeyCancel(e)) setError(`${label} was cancelled — tap again to try`)
      else setError(e instanceof Error ? e.message : 'Could not clock')
    } finally {
      setBusy(false)
    }
  }

  if (!me.employee) {
    return (
      <section className="clock-card" aria-label="Attendance">
        <div className="clock-card__main">
          <strong>Clock in</strong>
          <span>Your login is not linked to an employee record yet. Ask HR to link it, then you can clock in here.</span>
        </div>
      </section>
    )
  }

  const worked = day?.clockIn ? hoursBetween(day.clockIn, day.clockOut ?? new Date().toISOString()) : 0
  const h = Math.floor(worked)
  const m = Math.round((worked - h) * 60)
  const value = day?.clockOut ? payableValue({ ...day, status: 'approved' }) : null

  if (variant === 'hero') {
    const now = new Date()
    const hour = Number(now.toLocaleTimeString('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Africa/Nairobi' }))
    const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
    return (
      <section className="hrh-hero" aria-label="Attendance">
        <div className="min-w-0">
          <div className="hrh-hero__date">{now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Africa/Nairobi' }).toUpperCase()}</div>
          <h2>{greet}{firstName ? `, ${firstName}` : ''}</h2>
          <p>
            {action === 'in' ? "You haven't clocked in today."
              : action === 'out' ? `Clocked in at ${time(day!.clockIn)} · ${h}h ${String(m).padStart(2, '0')}m so far`
              : `Done for today: ${time(day!.clockIn)}–${time(day!.clockOut)} · ${value === 1 ? 'full day' : value === 0.5 ? 'half day' : 'under 3 hours'}`}
          </p>
          <div className="hrh-hero__chips">
            <span>{me.inOffice ? '✓ On the office Wi-Fi' : `⚠ ${me.officeNetworksSet ? 'Not on office Wi-Fi' : 'Office Wi-Fi not set up'} — a supervisor approves`}</span>
            <span>{me.hasPasskey ? `✓ ${label} ready` : <>⚠ No {label} — <button type="button" onClick={() => setSetup(v => !v)}>set it up</button></>}</span>
            {day && day.status !== 'approved' && <span>{day.status === 'rejected' ? 'Day rejected' : 'Waiting for a supervisor'}</span>}
          </div>
          {error && <p className="hrh-hero__err" role="alert">{error}</p>}
          {setup && !me.hasPasskey && <div className="hrh-hero__setup"><PasskeySettings showToast={(msg, type) => { showToast?.(msg, type); void load() }} /></div>}
        </div>
        <div className="hrh-hero__right">
          <div className="hrh-hero__clock">{now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Nairobi' })}</div>
          {action && <button type="button" className="hrh-hero__btn" disabled={busy} onClick={() => void punch()}>{busy ? 'Checking…' : action === 'in' ? 'Clock in' : 'Clock out'}</button>}
        </div>
      </section>
    )
  }

  return (
    <section className={`clock-card${action === 'out' ? ' is-in' : ''}`} aria-label="Attendance">
      <div className="clock-card__main">
        <strong>
          {action === 'in' ? 'Not clocked in today'
            : action === 'out' ? `Clocked in at ${time(day!.clockIn)} · ${h}h ${String(m).padStart(2, '0')}m`
            : `${time(day!.clockIn)}–${time(day!.clockOut)} · ${value === 1 ? 'full day' : value === 0.5 ? 'half day' : 'under 3 hours'}`}
        </strong>
        <span className="clock-card__checks">
          <em className={me.inOffice ? 'is-ok' : 'is-warn'}>{me.inOffice ? 'Office connection' : me.officeNetworksSet ? 'Not on the office Wi-Fi' : 'Office connection not set up'}</em>
          <em className={me.hasPasskey ? 'is-ok' : 'is-warn'}>
            {me.hasPasskey ? `${label} on` : <>No {label} — <button type="button" className="clock-card__link" onClick={() => setSetup(v => !v)}>set it up</button></>}
          </em>
          {day && day.status !== 'approved' && <em className="is-warn">{day.status === 'rejected' ? 'Day rejected' : 'Waiting for a supervisor'}</em>}
        </span>
        {action && (!me.inOffice || !me.hasPasskey) && (
          <span className="clock-card__hint">You can still clock {action}; a supervisor approves the day.</span>
        )}
        {error && <span className="clock-card__error" role="alert">{error}</span>}
        {setup && !me.hasPasskey && (
          <div className="clock-card__setup">
            <PasskeySettings showToast={(msg, type) => { showToast?.(msg, type); void load() }} />
          </div>
        )}
      </div>
      {action && (
        <button type="button" className={action === 'in' ? 'btn-primary' : 'btn-outline'} disabled={busy} onClick={() => void punch()}>
          {busy ? 'Checking…' : action === 'in' ? 'Clock in' : 'Clock out'}
        </button>
      )}
    </section>
  )
}
