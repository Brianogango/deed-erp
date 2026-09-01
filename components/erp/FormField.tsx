'use client'

import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react'

/**
 * Consistent accessible label/help/error wrapper for ERP form controls.
 * Existing control ids are preserved unless an explicit htmlFor is supplied.
 */
export function FormField({
  label,
  required = false,
  hint,
  error,
  children,
  className = '',
  htmlFor,
}: {
  label: string
  required?: boolean
  hint?: ReactNode
  error?: ReactNode
  children: ReactNode
  className?: string
  htmlFor?: string
}) {
  const generatedId = useId()
  const childProps = isValidElement(children)
    ? (children.props as Record<string, unknown>)
    : undefined
  const existingId = typeof childProps?.id === 'string' && childProps.id.trim()
    ? childProps.id
    : undefined
  const inputId = htmlFor || existingId || `erp-field-${generatedId.replace(/:/g, '')}`
  const hintId = `${inputId}-hint`
  const errorId = `${inputId}-error`
  const existingDescribedBy = typeof childProps?.['aria-describedby'] === 'string'
    ? childProps['aria-describedby']
    : undefined
  const describedBy = [existingDescribedBy, hint ? hintId : '', error ? errorId : ''].filter(Boolean).join(' ') || undefined

  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, {
        id: inputId,
        'aria-invalid': error ? true : childProps?.['aria-invalid'],
        'aria-describedby': describedBy,
      })
    : children

  return (
    <div className={`min-w-0 ${className}`.trim()}>
      <label htmlFor={inputId} className="mb-1.5 block text-xs font-semibold text-[var(--text-2)]">
        {label}
        {required && <span className="ml-1 text-[var(--danger)]" aria-hidden="true">*</span>}
        {required && <span className="sr-only"> required</span>}
      </label>
      {control}
      {hint && !error && <div id={hintId} className="mt-1 text-[10px] leading-4 text-[var(--text-4)]">{hint}</div>}
      {error && <div id={errorId} className="mt-1 text-[11px] leading-4 text-[var(--danger)]" role="alert">{error}</div>}
    </div>
  )
}
