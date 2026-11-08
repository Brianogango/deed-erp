'use client'

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { ErrorState } from './ErrorState'

/** A tab opened before a deploy asks for files the new build replaced. */
const STALE_BUILD = [
  /ChunkLoadError/i,
  /Loading chunk [\w-]+ failed/i,
  /Loading CSS chunk/i,
  /failed to fetch dynamically imported module/i,
  /Importing a module script failed/i,
  /Unexpected token '<'/,
]
const isStaleBuild = (e: Error | null) => Boolean(e) && STALE_BUILD.some(re => re.test(`${e!.name}: ${e!.message}`))

/**
 * Keeps the app shell (sidebar, top bar) usable when a module tree throws.
 * Without this, a Finance/Operations render crash takes down every route.
 *
 * After a deploy, an open tab fails to load a module's files: the page is
 * reloaded once (per module, per tab session) to pick up the new build.
 * Any other failure shows its message, so a screenshot says what broke.
 */
export class ModuleRenderBoundary extends Component<
  { pathname: string; children: ReactNode },
  { hasError: boolean; error: Error | null }
> {
  state = { hasError: false, error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[module-render-boundary]', this.props.pathname, error, info.componentStack)
    if (isStaleBuild(error)) {
      const key = `deed_stale_module_reload:${this.props.pathname}`
      try {
        if (!window.sessionStorage.getItem(key)) {
          window.sessionStorage.setItem(key, String(Date.now()))
          window.location.reload()
        }
      } catch { /* storage blocked: the message below still offers a reload */ }
    }
  }

  componentDidUpdate(prevProps: { pathname: string }) {
    if (prevProps.pathname !== this.props.pathname && this.state.hasError) {
      this.setState({ hasError: false, error: null })
    }
  }

  render() {
    if (this.state.hasError) {
      const stale = isStaleBuild(this.state.error)
      const detail = this.state.error ? `${this.state.error.name}: ${this.state.error.message}`.slice(0, 300) : ''
      return (
        <div>
          <ErrorState
            title={stale ? 'The ERP was updated — reload to continue' : 'This module failed to load'}
            description={stale
              ? 'This tab still has the previous version. Reloading picks up the new one; nothing you saved is lost.'
              : 'The rest of the ERP is still available. Try again, or open another module from the sidebar.'}
            retry={() => (stale ? window.location.reload() : this.setState({ hasError: false, error: null }))}
          />
          {detail && !stale && (
            <p className="mx-4 mt-2 text-[11px] font-mono break-words" style={{ color: 'var(--text-3)' }}>
              {this.props.pathname} · {detail}
            </p>
          )}
        </div>
      )
    }
    return this.props.children
  }
}
