'use client'

import { useState, type ButtonHTMLAttributes, type ReactNode } from 'react'

/**
 * Prevents duplicate submits and gives consistent processing/success/error feedback.
 */
export function AsyncActionButton({
  action,
  children,
  pendingLabel = 'Processing…',
  successLabel,
  className = 'btn-primary erp-action-btn',
  disabled,
  onError,
  ...buttonProps
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> & {
  action: () => void | Promise<void>
  children: ReactNode
  pendingLabel?: string
  successLabel?: string
  onError?: (error: unknown) => void
}) {
  const [state, setState] = useState<'idle' | 'pending' | 'success'>('idle')

  async function run() {
    if (state === 'pending' || disabled) return
    setState('pending')
    try {
      await action()
      if (successLabel) {
        setState('success')
        window.setTimeout(() => setState('idle'), 1600)
      } else {
        setState('idle')
      }
    } catch (error) {
      setState('idle')
      onError?.(error)
    }
  }

  const label = state === 'pending' ? pendingLabel : state === 'success' && successLabel ? successLabel : children

  return (
    <button
      {...buttonProps}
      type={buttonProps.type ?? 'button'}
      className={className}
      disabled={disabled || state === 'pending'}
      aria-busy={state === 'pending'}
      onClick={run}
    >
      {state === 'pending' && <span className="mr-2 inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent align-[-2px]" aria-hidden="true" />}
      {label}
    </button>
  )
}
