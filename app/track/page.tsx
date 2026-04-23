'use client'

import { useState, FormEvent } from 'react'
import { useRouter } from 'next/navigation'

export default function TrackRepairPage() {
  const router = useRouter()
  const [ref, setRef] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const trimmed = ref.trim().toUpperCase()
    if (!trimmed) return

    setLoading(true)
    setError(null)

    try {
      const res = await fetch(`/api/portal/repair/${encodeURIComponent(trimmed)}`)
      if (res.status === 404) {
        setError('No repair found with that reference. Please double-check the number on your receipt.')
        return
      }
      if (!res.ok) throw new Error('Unexpected error')
      router.push(`/track/${encodeURIComponent(trimmed)}`)
    } catch {
      setError('Something went wrong. Please try again or contact us directly.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4 py-16"
      style={{ background: 'linear-gradient(135deg, #090b12 0%, #0d1020 50%, #131728 100%)' }}
    >
      {/* Card */}
      <div
        className="w-full max-w-md rounded-2xl p-8"
        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 24px 64px rgba(0,0,0,0.5)' }}
      >
        {/* Logo / Brand */}
        <div className="flex items-center gap-3 mb-8">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-lg"
            style={{ background: 'linear-gradient(135deg, #06AED4, #0284C7)' }}
          >
            D
          </div>
          <div>
            <p className="font-bold text-white text-sm leading-tight">Deed Technologies</p>
            <p style={{ fontSize: 11, color: '#555A73' }}>Repair Management System</p>
          </div>
        </div>

        {/* Heading */}
        <h1 className="text-2xl font-bold text-white mb-1">Track Your Repair</h1>
        <p style={{ fontSize: 13, color: '#9095B0', marginBottom: 28 }}>
          Enter the repair reference number from your intake receipt to check the latest status of your device.
        </p>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <label style={{ fontSize: 11, fontWeight: 600, color: '#9095B0', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Repair Reference
          </label>
          <input
            type="text"
            value={ref}
            onChange={e => { setRef(e.target.value); setError(null) }}
            placeholder="e.g. REP/0040"
            autoFocus
            style={{
              background: 'rgba(255,255,255,0.05)',
              border: error ? '1.5px solid #F04438' : '1.5px solid rgba(255,255,255,0.1)',
              borderRadius: 10,
              padding: '12px 16px',
              color: '#fff',
              fontSize: 15,
              fontFamily: 'monospace',
              outline: 'none',
              letterSpacing: '0.05em',
              transition: 'border-color 0.15s',
            }}
            onFocus={e => { if (!error) e.currentTarget.style.borderColor = '#06AED4' }}
            onBlur={e => { if (!error) e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)' }}
          />

          {error && (
            <div
              className="flex items-start gap-2 rounded-lg p-3"
              style={{ background: 'rgba(240,68,56,0.1)', border: '1px solid rgba(240,68,56,0.3)', fontSize: 12, color: '#FDA29B' }}
            >
              <span style={{ fontSize: 14, flexShrink: 0 }}>⚠</span>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !ref.trim()}
            style={{
              background: loading || !ref.trim() ? 'rgba(6,174,212,0.3)' : 'linear-gradient(135deg, #06AED4, #0284C7)',
              border: 'none',
              borderRadius: 10,
              padding: '13px 0',
              color: '#fff',
              fontWeight: 700,
              fontSize: 14,
              cursor: loading || !ref.trim() ? 'not-allowed' : 'pointer',
              transition: 'opacity 0.15s',
              marginTop: 4,
            }}
          >
            {loading ? 'Looking up...' : 'Track Repair →'}
          </button>
        </form>

        {/* Hint */}
        <div
          className="mt-6 rounded-lg p-3"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
        >
          <p style={{ fontSize: 11, color: '#555A73', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Demo references
          </p>
          {['REP/0038', 'REP/0039', 'REP/0040'].map(r => (
            <button
              key={r}
              onClick={() => { setRef(r); setError(null) }}
              style={{ display: 'inline-block', marginRight: 8, marginTop: 4, fontSize: 12, color: '#06AED4', background: 'rgba(6,174,212,0.1)', border: '1px solid rgba(6,174,212,0.2)', borderRadius: 6, padding: '2px 8px', cursor: 'pointer', fontFamily: 'monospace' }}
            >
              {r}
            </button>
          ))}
          <p style={{ fontSize: 11, color: '#444A60', marginTop: 6 }}>REP/0040 has a quote waiting for your approval.</p>
        </div>
      </div>

      {/* Footer contact */}
      <div className="mt-8 text-center" style={{ color: '#444A60', fontSize: 12 }}>
        <p>Need help? Speak to us directly</p>
        <p className="mt-1">
          <a href="tel:+254700000000" style={{ color: '#06AED4' }}>+254 700 000 000</a>
          {' · '}
          <a href="mailto:repairs@deed.co.ke" style={{ color: '#06AED4' }}>repairs@deed.co.ke</a>
        </p>
      </div>
    </div>
  )
}
