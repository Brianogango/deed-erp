'use client'

import type { ButtonHTMLAttributes, ReactNode } from 'react'

/**
 * Icon-only control with a guaranteed accessible name and a 44px touch target.
 * Use for compact shell, toolbar and mobile actions instead of unlabeled icons.
 */
export function AccessibleIconButton({
  label,
  children,
  pressed,
  className = '',
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'aria-pressed'> & {
  label: string
  children: ReactNode
  pressed?: boolean
}) {
  return (
    <button
      {...props}
      type={props.type ?? 'button'}
      aria-label={label}
      aria-pressed={pressed}
      title={props.title ?? label}
      className={`inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${className}`.trim()}
    >
      <span aria-hidden="true" className="inline-flex items-center justify-center">
        {children}
      </span>
    </button>
  )
}
