'use client'

import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

const VARIANT_CLASS: Record<Variant, string> = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  ghost: 'btn-ghost',
  danger: 'btn-danger',
}

/**
 * Permission-aware action button with consistent hierarchy.
 * Use one primary action per page; demote everything else.
 */
export function PrimaryActionButton({
  children,
  icon,
  variant = 'primary',
  hideLabelOnMobile = true,
  className = '',
  'aria-label': ariaLabel,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode
  icon?: ReactNode
  variant?: Variant
  /** When true, short-label screens hide the text and rely on aria-label/icon. */
  hideLabelOnMobile?: boolean
}) {
  const labelClass = hideLabelOnMobile ? 'hidden sm:inline' : undefined
  const resolvedAria = ariaLabel ?? (typeof children === 'string' ? children : undefined)
  return (
    <button
      type="button"
      className={`${VARIANT_CLASS[variant]} erp-action-btn flex items-center gap-2 flex-shrink-0 ${className}`.trim()}
      aria-label={resolvedAria}
      {...props}
    >
      {icon && <span aria-hidden="true">{icon}</span>}
      <span className={labelClass}>{children}</span>
    </button>
  )
}
