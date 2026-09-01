'use client'

import type { ReactNode } from 'react'

export type WorkflowStage = {
  id: string
  label: string
  description?: string
  disabled?: boolean
  icon?: ReactNode
}

/**
 * Shared record workflow indicator.
 * Keeps the current state, completed states, next state and blockers visually predictable.
 */
export function WorkflowStageBar({
  stages,
  current,
  blocker,
  className = '',
  layout = 'scroll',
}: {
  stages: WorkflowStage[]
  current: string
  blocker?: string | null
  className?: string
  /**
   * `scroll` preserves the compact single-line treatment for short workflows.
   * `wrap` removes horizontal scrolling and lets long operational workflows use
   * the available width in clean rows.
   */
  layout?: 'scroll' | 'wrap'
}) {
  const currentIndex = Math.max(0, stages.findIndex(stage => stage.id === current))
  const wrapped = layout === 'wrap'

  return (
    <section className={`rounded-xl border border-[var(--border-lt)] bg-[var(--bg-card)] px-3 py-3 sm:px-4 ${className}`.trim()} aria-label="Workflow progress">
      <div className={wrapped ? 'overflow-visible' : 'overflow-x-auto pb-1'}>
        <ol
          className={wrapped
            ? 'grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-7'
            : 'flex min-w-max items-start gap-1'}
          role="list"
        >
          {stages.map((stage, index) => {
            const complete = index < currentIndex
            const active = index === currentIndex
            const upcoming = index > currentIndex
            return (
              <li key={stage.id} className={wrapped ? 'min-w-0' : 'flex items-start'}>
                <div
                  className={`flex min-w-0 items-start gap-2 rounded-lg px-2.5 py-2 ${wrapped ? 'h-full w-full' : 'min-w-[132px]'} ${
                    active
                      ? 'bg-[var(--primary-light)] text-[var(--text-1)] ring-1 ring-inset ring-[var(--primary)]/20'
                      : complete
                        ? 'bg-[var(--success-bg)]/40 text-[var(--success-text)]'
                        : 'text-[var(--text-4)]'
                  } ${stage.disabled ? 'opacity-50' : ''}`}
                  aria-current={active ? 'step' : undefined}
                >
                  <span
                    className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[10px] font-bold ${
                      active
                        ? 'border-[var(--primary)] bg-[var(--primary)] text-white'
                        : complete
                          ? 'border-[var(--success)] bg-[var(--success-bg)] text-[var(--success-text)]'
                          : 'border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-4)]'
                    }`}
                    aria-hidden="true"
                  >
                    {stage.icon ?? (complete ? '✓' : index + 1)}
                  </span>
                  <span className="min-w-0">
                    <span className={`block text-[11px] font-semibold leading-4 sm:text-xs ${upcoming ? 'font-medium' : ''}`}>{stage.label}</span>
                    {stage.description && <span className="mt-0.5 block max-w-[150px] text-[10px] leading-4 text-[var(--text-4)]">{stage.description}</span>}
                  </span>
                </div>
                {!wrapped && index < stages.length - 1 && (
                  <span className={`mt-4 h-px w-5 shrink-0 ${index < currentIndex ? 'bg-[var(--success)]' : 'bg-[var(--border)]'}`} aria-hidden="true" />
                )}
              </li>
            )
          })}
        </ol>
      </div>
      {blocker && (
        <div className="mt-2 flex items-start gap-2 rounded-lg bg-[var(--warning-bg)] px-3 py-2 text-xs text-[var(--warning-text)]" role="status">
          <span aria-hidden="true">!</span>
          <span><strong>Blocked:</strong> {blocker}</span>
        </div>
      )}
    </section>
  )
}
