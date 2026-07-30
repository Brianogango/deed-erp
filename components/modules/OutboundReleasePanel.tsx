// @ts-nocheck
'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import {
  faBoxOpen, faShieldHalved, faSignature, faCircleCheck,
  faTriangleExclamation, faXmark, faPen, faArrowLeft, faCamera,
} from '@fortawesome/free-solid-svg-icons'
import { useOperationsStore, OutboundRelease, OrcItem, SignatureMethod } from '@/lib/store'
import { normalizeClientRole } from '@/lib/auth/access'
import { Modal, Field, Input } from '@/components/ui'
import { Fa } from '@/components/icons'
import { BarcodeScannerModal } from '@/components/BarcodeScanner'
import { resolveOrcConfirmedSerial } from '@/lib/barcode-scan'

// ─── Signature Canvas ─────────────────────────────────────────────────────────

function SignatureCanvas({ onSave, onClear, existingData }: {
  onSave: (data: string) => void
  onClear: () => void
  existingData?: string
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing   = useRef(false)
  const [hasStroke, setHasStroke] = useState(!!existingData)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    ctx.strokeStyle = '#1B2762'
    ctx.lineWidth   = 2
    ctx.lineCap     = 'round'
    if (existingData) {
      const img = new Image()
      img.onload = () => ctx.drawImage(img, 0, 0)
      img.src = existingData
    }
  }, [existingData])

  const getPos = (e: MouseEvent | TouchEvent, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect()
    const src  = 'touches' in e ? e.touches[0] : e
    return { x: src.clientX - rect.left, y: src.clientY - rect.top }
  }

  const start = useCallback((e: any) => {
    const canvas = canvasRef.current!
    const ctx    = canvas.getContext('2d')!
    const { x, y } = getPos(e, canvas)
    ctx.beginPath()
    ctx.moveTo(x, y)
    drawing.current = true
    setHasStroke(true)
  }, [])

  const move = useCallback((e: any) => {
    if (!drawing.current) return
    e.preventDefault()
    const canvas = canvasRef.current!
    const ctx    = canvas.getContext('2d')!
    const { x, y } = getPos(e, canvas)
    ctx.lineTo(x, y)
    ctx.stroke()
  }, [])

  const end = useCallback(() => {
    drawing.current = false
    const canvas = canvasRef.current!
    onSave(canvas.toDataURL('image/png'))
  }, [onSave])

  const clear = () => {
    const canvas = canvasRef.current!
    canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height)
    setHasStroke(false)
    onClear()
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="border-2 border-dashed border-[var(--border-lt)] rounded-xl overflow-hidden bg-white relative" style={{ touchAction: 'none' }}>
        <canvas
          ref={canvasRef}
          width={400} height={150}
          className="w-full"
          onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
          onTouchStart={start} onTouchMove={move} onTouchEnd={end}
          style={{ cursor: 'crosshair', display: 'block' }}
        />
        {!hasStroke && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-[11px] text-[var(--text-4)]">Sign here</p>
          </div>
        )}
      </div>
      <button onClick={clear} className="text-[10px] text-[var(--text-4)] hover:text-red-500 self-start underline">
        Clear signature
      </button>
    </div>
  )
}

// ─── Step indicator ───────────────────────────────────────────────────────────

const STEPS = [
  { label: 'Pick',   icon: faBoxOpen       },
  { label: 'Verify', icon: faShieldHalved  },
  { label: 'Sign',   icon: faSignature     },
  { label: 'Done',   icon: faCircleCheck   },
]

function StepBar({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-0 mb-6">
      {STEPS.map((s, i) => {
        const done    = i < current
        const active  = i === current
        const last    = i === STEPS.length - 1
        return (
          <div key={s.label} className="flex items-center flex-1">
            <div className="flex flex-col items-center gap-1 flex-shrink-0">
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-xs transition-all"
                style={{
                  background: done || active ? 'var(--navy)' : 'var(--bg-surface)',
                  color:      done || active ? '#fff'    : 'var(--text-4)',
                  border:     `2px solid ${done || active ? 'var(--navy)' : 'var(--border-lt)'}`,
                }}
              >
                <Fa icon={s.icon} />
              </div>
              <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: active ? 'var(--navy)' : 'var(--text-4)' }}>
                {s.label}
              </span>
            </div>
            {!last && (
              <div className="flex-1 h-0.5 mx-1 mb-4" style={{ background: done ? 'var(--navy)' : 'var(--border-lt)' }} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Serial match badge ───────────────────────────────────────────────────────

function MatchBadge({ matched }: { matched?: boolean }) {
  if (matched === undefined) return null
  return matched
    ? <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700">MATCH</span>
    : <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-600 flex items-center gap-1"><Fa icon={faTriangleExclamation} /> MISMATCH</span>
}

// ─── Main panel ───────────────────────────────────────────────────────────────

interface OutboundReleasePanelProps {
  release: OutboundRelease
  isRepair?: boolean
  onClose: () => void
}

export function OutboundReleasePanel({ release, isRepair = false, onClose }: OutboundReleasePanelProps) {
  const { verifyReleaseItem, completeVerification, completeRelease, voidRelease, pickRelease, currentUserId, users, repairs, serials, showToast } = useOperationsStore()

  const currentUser = users.find(u => u.id === currentUserId)
  // Look up the linked repair (if this is a repair release) to show intake accessories
  const linkedRepair = isRepair && release.repairId ? repairs.find((r: any) => r.id === release.repairId) : undefined
  const intakeAccessories: { name: string; received: boolean }[] = linkedRepair?.accessories ?? []
  const currentRole = normalizeClientRole(currentUser?.role)
  const canVerify   = ['release_authoriser', 'director', 'admin_officer'].includes(currentRole)

  // Derive UI step from release status
  const statusToStep = { pending: 0, all_picked: 1, verified: 2, released: 3, voided: 0 }
  const [step, setStep]         = useState(statusToStep[release.status] ?? 0)
  const [confirmedSerials, setConfirmedSerials] = useState<Record<string, string>>({})
  const [scanItemId, setScanItemId] = useState<string | null>(null)
  const [receivedBy, setReceivedBy]     = useState(release.receivedBy ?? '')
  const [receivedByPhone, setReceivedByPhone] = useState(release.receivedByPhone ?? '')
  const [releaseNotes, setReleaseNotes] = useState(release.releaseNotes ?? '')
  const [conditionOnRelease, setConditionOnRelease] = useState(release.conditionOnRelease ?? '')
  const [receiverSigData, setReceiverSigData]   = useState<string | undefined>(release.receiverSigData)
  const [customerAckSigData, setCustomerAckSigData] = useState<string | undefined>(release.customerAckSigData)
  const [sigMethod, setSigMethod]       = useState<SignatureMethod>('digital')
  const [paperRef, setPaperRef]         = useState('')
  const [voidReason, setVoidReason]     = useState('')
  const [showVoid, setShowVoid]         = useState(false)
  const [submitting, setSubmitting]     = useState(false)

  // Update step if release status changes externally
  useEffect(() => { setStep(statusToStep[release.status] ?? 0) }, [release.status])

  const handlePick = () => {
    pickRelease(release.id)
    setStep(1)
  }

  const handleVerifyAll = () => {
    if (!canVerify) { showToast('Only Release Authorisers, Directors, or Admin Officers can verify', 'error'); return }
    // Apply all confirmed serials (resolve inventory barcodes → manufacturer serial)
    release.items.forEach(item => {
      const raw = confirmedSerials[item.id] ?? item.confirmedSerial ?? ''
      if (!raw) return
      const result = resolveOrcConfirmedSerial({
        scanned: raw,
        expectedSerial: item.expectedSerial,
        serials,
      })
      verifyReleaseItem(release.id, item.id, result.confirmed)
    })
    completeVerification(release.id, { verifiedById: currentUserId!, verifiedByName: currentUser?.name ?? '' })
    setStep(2)
  }

  const handleRelease = () => {
    if (!receivedBy.trim()) { showToast('Received-by name is required', 'error'); return }
    const hasSig = sigMethod === 'digital' ? !!receiverSigData : !!paperRef
    if (!hasSig) { showToast('Receiver signature is required', 'error'); return }
    setSubmitting(true)
    completeRelease(release.id, {
      receivedBy, receivedByPhone, releaseNotes, conditionOnRelease,
      receiverSigData:    sigMethod === 'digital' ? receiverSigData : undefined,
      receiverSigMethod:  sigMethod,
      receiverSigRef:     sigMethod === 'paper' ? paperRef : undefined,
      customerAckSigData: isRepair ? customerAckSigData : undefined,
      customerAckSigMethod: isRepair && customerAckSigData ? 'digital' : undefined,
    })
    setStep(3)
    setSubmitting(false)
  }

  const handleVoid = () => {
    if (!voidReason.trim()) { showToast('A void reason is required', 'error'); return }
    voidRelease(release.id, voidReason)
    onClose()
  }

  const allItemsConfirmed = release.items.every(i =>
    i.status === 'verified' || (confirmedSerials[i.id] ?? '').trim().length > 0
  )

  // ── Status: voided ────────────────────────────────────────────────────────
  if (release.status === 'voided') {
    return (
      <Modal title={`${release.ref} — Voided`} onClose={onClose} width={480}>
        <div className="p-4 rounded-xl bg-red-50 border border-red-100 text-xs text-red-700">
          <p className="font-bold mb-1">This release was voided</p>
          <p>{release.voidReason || 'No reason recorded'}</p>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title={`Release ${release.ref}`} onClose={onClose} width={560}>
      <div className="flex flex-col gap-4">
        <StepBar current={step} />

        {/* Source info */}
        <div className="p-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-lt)] text-xs flex items-center justify-between">
          <div>
            <span className="font-bold text-[var(--text-1)]">{release.sourceRef}</span>
            <span className="text-[var(--text-4)] ml-2">· {release.clientName}</span>
          </div>
          <span className="text-[9px] font-bold px-2 py-0.5 rounded-full uppercase" style={{ background: '#1B276215', color: 'var(--navy)' }}>
            {release.sourceType?.replace('_', ' ')}
          </span>
        </div>

        {/* ── Step 0: Pick ──────────────────────────────────────────────── */}
        {step === 0 && (
          <div className="flex flex-col gap-4">
            <p className="text-xs text-[var(--text-3)]">Confirm the following items have been physically pulled from the shelf.</p>
            <div className="border border-[var(--border-lt)] rounded-xl overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-[var(--bg-surface)] border-b border-[var(--border-lt)]">
                    <th className="px-3 py-2 text-[10px] font-bold uppercase text-[var(--text-4)]">Expected Serial</th>
                    <th className="px-3 py-2 text-[10px] font-bold uppercase text-[var(--text-4)]">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-lt)]">
                  {release.items.map(item => (
                    <tr key={item.id}>
                      <td className="px-3 py-2.5 font-mono text-[11px] font-bold text-[var(--text-1)]">{item.expectedSerial}</td>
                      <td className="px-3 py-2.5">
                        <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Picked</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-between items-center pt-2 border-t border-[var(--border-lt)]">
              <button onClick={() => setShowVoid(true)} className="text-xs text-red-500 hover:underline">
                Void Release
              </button>
              <button onClick={handlePick} className="btn-primary text-xs">
                All Items Picked — Continue
              </button>
            </div>
          </div>
        )}

        {/* ── Step 1: Verify serials ────────────────────────────────────── */}
        {step === 1 && (
          <div className="flex flex-col gap-4">
            {!canVerify && (
              <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-center gap-2">
                <Fa icon={faTriangleExclamation} />
                Only Release Authorisers, Directors, or Admin Officers can complete verification.
              </div>
            )}
            <p className="text-xs text-[var(--text-3)]">
              Scan or type each serial / inventory barcode from the physical device and confirm it matches the source document.
            </p>
            <div className="flex flex-col gap-3">
              {release.items.map(item => {
                const confirmed = confirmedSerials[item.id] ?? item.confirmedSerial ?? ''
                const resolved = confirmed
                  ? resolveOrcConfirmedSerial({ scanned: confirmed, expectedSerial: item.expectedSerial, serials })
                  : null
                const matched   = resolved?.matched ?? (confirmed.trim().toLowerCase() === item.expectedSerial.trim().toLowerCase())
                const hasInput  = confirmed.trim().length > 0
                return (
                  <div key={item.id} className="p-3 rounded-xl border border-[var(--border-lt)] bg-[var(--bg-surface)] flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-[10px] text-[var(--text-4)] uppercase font-bold tracking-wider">Expected Serial</p>
                        <p className="font-mono text-sm font-bold text-[var(--text-1)] tracking-wider mt-0.5">{item.expectedSerial}</p>
                      </div>
                      {hasInput && <MatchBadge matched={matched} />}
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="btn-secondary px-3 min-w-[44px] min-h-[44px] flex items-center justify-center cursor-pointer"
                        title="Open camera scanner"
                        aria-label="Open camera scanner"
                        disabled={!canVerify || item.status === 'verified'}
                        onClick={() => setScanItemId(item.id)}
                      >
                        <Fa icon={faCamera} />
                      </button>
                      <input
                        className="form-input font-mono text-sm flex-1"
                        placeholder="Scan or type confirmed serial / barcode…"
                        value={confirmed}
                        onChange={e => setConfirmedSerials(prev => ({ ...prev, [item.id]: e.target.value }))}
                        onBlur={e => {
                          const value = e.target.value
                          if (!value.trim()) return
                          const result = resolveOrcConfirmedSerial({
                            scanned: value,
                            expectedSerial: item.expectedSerial,
                            serials,
                          })
                          setConfirmedSerials(prev => ({ ...prev, [item.id]: result.confirmed }))
                        }}
                        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                        autoComplete="off"
                        disabled={!canVerify || item.status === 'verified'}
                      />
                    </div>
                    {hasInput && !matched && (
                      <p className="text-[10px] text-red-600 flex items-center gap-1">
                        <Fa icon={faTriangleExclamation} />
                        Serial mismatch — this will be flagged in the audit log. Proceed only if you are certain this is the correct item.
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
            <BarcodeScannerModal
              open={!!scanItemId}
              onClose={() => setScanItemId(null)}
              title="Verify unit label"
              hint="Scan the unit QR or barcode. Inventory barcodes are resolved to the manufacturer serial automatically."
              onScan={(code) => {
                if (!scanItemId) return
                const item = release.items.find(i => i.id === scanItemId)
                if (!item) return
                const result = resolveOrcConfirmedSerial({
                  scanned: code,
                  expectedSerial: item.expectedSerial,
                  serials,
                })
                setConfirmedSerials(prev => ({ ...prev, [scanItemId]: result.confirmed }))
                showToast(result.matched ? `Matched ${result.confirmed}` : `Scanned ${result.confirmed} — check mismatch`, result.matched ? 'success' : 'error')
                setScanItemId(null)
              }}
            />
            <div className="flex justify-between items-center pt-2 border-t border-[var(--border-lt)]">
              <button onClick={() => setShowVoid(true)} className="text-xs text-red-500 hover:underline">
                Void Release
              </button>
              <button
                onClick={handleVerifyAll}
                disabled={!canVerify || !allItemsConfirmed}
                className="btn-primary text-xs disabled:opacity-50"
              >
                Confirm Verification
              </button>
            </div>
          </div>
        )}

        {/* ── Step 2: Sign & Release ────────────────────────────────────── */}
        {step === 2 && (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Received By *">
                <Input value={receivedBy} onChange={setReceivedBy} placeholder="Customer / courier name" />
              </Field>
              <Field label="Phone">
                <Input value={receivedByPhone} onChange={setReceivedByPhone} placeholder="+254…" />
              </Field>
            </div>
            {/* Accessories from intake */}
            {isRepair && intakeAccessories.length > 0 && (
              <div className="rounded-xl border border-[var(--border-lt)] p-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-4)] mb-2">Accessories Received at Intake</p>
                <div className="flex flex-wrap gap-2">
                  {intakeAccessories.map((acc: { name: string; received: boolean }) => (
                    <span
                      key={acc.name}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold"
                      style={{ background: 'rgba(0,174,239,0.10)', color: 'var(--accent-cyan)', border: '1px solid rgba(0,174,239,0.25)' }}
                    >
                      <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                        <path d="M2 6l3 3 5-5" stroke="#00AEEF" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                      {acc.name}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <Field label="Release Notes">
              <textarea
                className="form-input"
                rows={2}
                placeholder="Condition notes, any missing accessories…"
                value={releaseNotes}
                onChange={e => setReleaseNotes(e.target.value)}
              />
            </Field>
            {isRepair && (
              <Field label="Condition on Release">
                <textarea
                  className="form-input"
                  rows={2}
                  placeholder="Describe device condition at handover (compare to intake)…"
                  value={conditionOnRelease}
                  onChange={e => setConditionOnRelease(e.target.value)}
                />
              </Field>
            )}

            {/* Signature method toggle */}
            <div className="flex gap-2">
              {(['digital', 'paper'] as SignatureMethod[]).map(m => (
                <button
                  key={m}
                  onClick={() => setSigMethod(m)}
                  className="flex-1 py-2 rounded-xl border text-xs font-bold transition-all capitalize"
                  style={{
                    background: sigMethod === m ? 'var(--navy)' : 'var(--bg-surface)',
                    color:      sigMethod === m ? '#fff'    : 'var(--text-3)',
                    border:     `1px solid ${sigMethod === m ? 'var(--navy)' : 'var(--border-lt)'}`,
                  }}
                >
                  <Fa icon={faPen} className="mr-1.5" />{m === 'digital' ? 'Digital Signature' : 'Paper (signed printout)'}
                </button>
              ))}
            </div>

            {sigMethod === 'digital' ? (
              <div className="flex flex-col gap-2">
                <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-4)]">Receiver Signature *</p>
                <SignatureCanvas
                  onSave={setReceiverSigData}
                  onClear={() => setReceiverSigData(undefined)}
                  existingData={receiverSigData}
                />

              </div>
            ) : (
              <Field label="Signed Document Reference *">
                <Input
                  value={paperRef}
                  onChange={setPaperRef}
                  placeholder="e.g. ORC-0001-signed.pdf or filing reference…"
                />
              </Field>
            )}

            <div className="flex justify-between items-center pt-2 border-t border-[var(--border-lt)]">
              <button onClick={() => setStep(1)} className="btn-outline flex items-center gap-1.5 text-xs">
                <Fa icon={faArrowLeft} /> Back
              </button>
              <button
                onClick={handleRelease}
                disabled={submitting}
                className="btn-primary text-xs"
                style={{ background: 'var(--success)' }}
              >
                <Fa icon={faCircleCheck} className="mr-1.5" />
                Release Item — Items Leave Building
              </button>
            </div>
          </div>
        )}

        {/* ── Step 3: Released ─────────────────────────────────────────── */}
        {(step === 3 || release.status === 'released') && (
          <div className="flex flex-col gap-4">
            <div className="p-4 rounded-2xl bg-green-50 border border-green-200 flex flex-col gap-2 items-center text-center">
              <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center text-green-600 text-xl">
                <Fa icon={faCircleCheck} />
              </div>
              <p className="text-sm font-extrabold text-green-800">{release.ref} — Released</p>
              <p className="text-xs text-green-700">
                Items left the building. Received by <strong>{release.receivedBy || receivedBy}</strong>.
              </p>
              {release.releasedAt && (
                <p className="text-[10px] text-green-600">{new Date(release.releasedAt).toLocaleString('en-KE')}</p>
              )}
            </div>

            {/* Audit log */}
            <div className="border border-[var(--border-lt)] rounded-xl overflow-hidden">
              <div className="px-3 py-2 bg-[var(--bg-surface)] border-b border-[var(--border-lt)]">
                <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-4)]">Audit Log</p>
              </div>
              <div className="divide-y divide-[var(--border-lt)]">
                {release.auditLog.map(log => (
                  <div key={log.id} className="px-3 py-2 flex items-center justify-between gap-2">
                    <div>
                      <p className="text-[11px] font-bold text-[var(--text-1)] capitalize">{log.action.replace(/_/g, ' ')}</p>
                      {log.notes && <p className="text-[10px] text-[var(--text-4)]">{log.notes}</p>}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-[10px] text-[var(--text-3)]">{log.performedByName ?? log.performedById}</p>
                      <p className="text-[9px] text-[var(--text-4)]">{new Date(log.performedAt).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <button onClick={onClose} className="btn-outline text-xs">Close</button>
          </div>
        )}

        {/* Void modal */}
        {showVoid && (
          <div className="mt-2 p-4 rounded-xl bg-red-50 border border-red-200 flex flex-col gap-3">
            <p className="text-xs font-bold text-red-800">Void this release?</p>
            <textarea
              className="form-input text-xs"
              rows={2}
              placeholder="Reason for voiding (required)…"
              value={voidReason}
              onChange={e => setVoidReason(e.target.value)}
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowVoid(false)} className="btn-outline text-xs">Cancel</button>
              <button onClick={handleVoid} className="text-xs px-3 py-1.5 rounded-lg bg-red-600 text-white font-bold hover:bg-red-700">
                Confirm Void
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}

// ─── Badge shown on source documents ─────────────────────────────────────────

export function OrcStatusBadge({ release, onClick }: { release: OutboundRelease; onClick?: () => void }) {
  const colours: Record<string, { bg: string; text: string }> = {
    pending:    { bg: '#FEF3C7', text: '#92400E' },
    all_picked: { bg: '#DBEAFE', text: '#1E40AF' },
    verified:   { bg: '#E0E7FF', text: '#3730A3' },
    released:   { bg: '#D1FAE5', text: '#065F46' },
    voided:     { bg: '#FEE2E2', text: '#991B1B' },
  }
  const c = colours[release.status] ?? colours.pending
  return (
    <button
      onClick={onClick}
      className="text-[9px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wider cursor-pointer hover:opacity-80 transition-opacity"
      style={{ background: c.bg, color: c.text }}
    >
      ORC · {release.ref} · {release.status.replace('_', ' ')}
    </button>
  )
}
