'use client'

import { useState, type ReactNode } from 'react'
import { AsyncActionButton } from './AsyncActionButton'

/**
 * Two-step destructive action control. Keeps cancel/void/delete/reverse actions visually
 * separated from normal workflow actions and requires explicit confirmation.
 */
export function DestructiveAction({
  label,
  confirmLabel = 'Confirm',
  warning,
  action,
  disabled = false,
  trigger,
}: {
  label: string
  confirmLabel?: string
  warning: string
  action: () => void | Promise<void>
  disabled?: boolean
  trigger?: ReactNode
}) {
  const [open, setOpen] = useState(false)

  if (!open) {
    return trigger ? (
      <span onClick={() => !disabled && setOpen(true)}>{trigger}</span>
    ) : (
      <button
        type="button"
        className="btn-ghost erp-action-btn text-[var(--danger)]"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        {label}
      </button>
    )
  }

  return (
    <div className="min-w-[260px] max-w-sm rounded-xl border border-[var(--danger)]/25 bg-[var(--bg-card)] p-3 shadow-lg" role="alertdialog" aria-label={`${label} confirmation`}>
      <div className="text-xs font-semibold text-[var(--text-1)]">{label}</div>
      <p className="mt-1 text-[11px] leading-4 text-[var(--text-3)]">{warning}</p>
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" className="btn-ghost erp-action-btn" onClick={() => setOpen(false)}>Keep record</button>
        <AsyncActionButton
          className="erp-action-btn rounded-lg bg-[var(--danger)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
          action={async () => {
            await action()
            setOpen(false)
          }}
          pendingLabel="Processing…"
        >
          {confirmLabel}
        </AsyncActionButton>
      </div>
    </div>
  )
}
