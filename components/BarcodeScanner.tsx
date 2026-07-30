'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import { Modal } from '@/components/ui'
import { Fa, faCamera } from '@/components/icons'
import { normalizeScanCode } from '@/lib/barcode-scan'

type BarcodeScannerModalProps = {
  open: boolean
  onClose: () => void
  onScan: (code: string) => void
  title?: string
  hint?: string
  /** Keep camera open and accept multiple scans (deduped). */
  continuous?: boolean
}

/**
 * Phone-camera barcode / QR scanner used by POS, transfers, GRN, and ORC.
 * Requires HTTPS (or localhost) and camera permission.
 */
export function BarcodeScannerModal({
  open,
  onClose,
  onScan,
  title = 'Scan barcode / QR',
  hint = 'Point the rear camera at the barcode or QR. Hold steady with good light.',
  continuous = false,
}: BarcodeScannerModalProps) {
  const reactId = useId().replace(/:/g, '')
  const readerId = `barcode-reader-${reactId}`
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const lastScanRef = useRef<{ code: string; at: number }>({ code: '', at: 0 })
  const onScanRef = useRef(onScan)
  onScanRef.current = onScan
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    let scanner: Html5Qrcode | null = null
    setError(null)
    setStarting(true)

    const start = async () => {
      // Wait a tick so the modal DOM node exists.
      await new Promise(r => setTimeout(r, 50))
      if (cancelled) return
      try {
        scanner = new Html5Qrcode(readerId)
      } catch (err) {
        console.error('Camera init error', err)
        if (!cancelled) {
          setError('Could not initialise the camera scanner on this device.')
          setStarting(false)
        }
        return
      }
      scannerRef.current = scanner

      try {
        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 250, height: 250 } },
          (decodedText) => {
            if (cancelled) return
            const code = normalizeScanCode(decodedText)
            if (!code) return
            const now = Date.now()
            if (
              codesRecentlyScanned(lastScanRef.current, code, now, continuous ? 1800 : 0)
            ) return
            lastScanRef.current = { code, at: now }
            onScanRef.current(code)
            if (!continuous) onClose()
          },
          () => {},
        )
        if (!cancelled) setStarting(false)
      } catch (err) {
        console.error('Camera start error', err)
        if (!cancelled) {
          setStarting(false)
          setError(
            'Could not start the camera. Use HTTPS, allow camera access, and retry. You can still type or use a USB scanner.',
          )
        }
      }
    }

    void start()

    return () => {
      cancelled = true
      scannerRef.current = null
      try {
        if (scanner?.isScanning) scanner.stop().catch(() => {})
      } catch {
        /* never started */
      }
    }
  }, [open, readerId, continuous, onClose])

  if (!open) return null

  return (
    <Modal title={title} onClose={onClose} width={400}>
      <div className="p-4 flex flex-col items-center gap-3">
        <div
          id={readerId}
          className="w-full overflow-hidden rounded-xl border-2 border-[var(--primary,#1A1F5E)] bg-black aspect-square"
          aria-label="Camera preview"
        />
        {starting && !error && (
          <p className="text-xs text-t3 text-center">Starting camera…</p>
        )}
        {error ? (
          <p className="text-xs text-center text-red-600 leading-relaxed" role="alert">{error}</p>
        ) : (
          <p className="text-xs text-t3 text-center leading-relaxed">{hint}</p>
        )}
        {continuous && !error && (
          <p className="text-[10px] font-semibold uppercase tracking-wider text-t4">
            Continuous mode — scan several units, then close
          </p>
        )}
        <button type="button" className="btn-outline w-full min-h-[44px]" onClick={onClose}>
          {continuous ? 'Done' : 'Cancel'}
        </button>
      </div>
    </Modal>
  )
}

function codesRecentlyScanned(
  last: { code: string; at: number },
  code: string,
  now: number,
  windowMs: number,
) {
  if (windowMs <= 0) return false
  return last.code === code && now - last.at < windowMs
}

type ScanInputRowProps = {
  value: string
  onChange: (value: string) => void
  onSubmit: (value: string) => void
  placeholder?: string
  disabled?: boolean
  inputRef?: React.Ref<HTMLInputElement>
  /** Called when camera decodes a code (parent usually submits). */
  onCameraScan?: (code: string) => void
  cameraTitle?: string
  continuous?: boolean
  className?: string
  mono?: boolean
}

/** Text + camera button used wherever serials/barcodes are collected. */
export function ScanInputRow({
  value,
  onChange,
  onSubmit,
  placeholder = 'Scan barcode or type + Enter…',
  disabled,
  inputRef,
  onCameraScan,
  cameraTitle,
  continuous = false,
  className = '',
  mono = true,
}: ScanInputRowProps) {
  const [showCamera, setShowCamera] = useState(false)
  const localRef = useRef<HTMLInputElement>(null)

  return (
    <>
      <div className={`flex gap-2 items-stretch ${className}`}>
        <button
          type="button"
          className="btn-secondary px-3 min-w-[44px] min-h-[44px] flex items-center justify-center cursor-pointer"
          title="Open camera scanner"
          aria-label="Open camera scanner"
          disabled={disabled}
          onClick={() => setShowCamera(true)}
        >
          <Fa icon={faCamera} />
        </button>
        <input
          ref={(el) => {
            ;(localRef as React.MutableRefObject<HTMLInputElement | null>).current = el
            if (typeof inputRef === 'function') inputRef(el)
            else if (inputRef && 'current' in inputRef) {
              ;(inputRef as React.MutableRefObject<HTMLInputElement | null>).current = el
            }
          }}
          className={`form-input flex-1 ${mono ? 'font-mono text-sm' : ''}`}
          placeholder={placeholder}
          value={value}
          disabled={disabled}
          autoComplete="off"
          onChange={e => onChange(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault()
              onSubmit(value)
            }
          }}
        />
        <button
          type="button"
          className="btn-primary px-4 min-h-[44px] cursor-pointer"
          disabled={disabled}
          onClick={() => onSubmit(value)}
        >
          Add
        </button>
      </div>
      <BarcodeScannerModal
        open={showCamera}
        onClose={() => setShowCamera(false)}
        continuous={continuous}
        title={cameraTitle}
        onScan={code => {
          onChange(code)
          if (onCameraScan) onCameraScan(code)
          else onSubmit(code)
        }}
      />
    </>
  )
}
