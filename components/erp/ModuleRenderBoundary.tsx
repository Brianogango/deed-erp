'use client'

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { ErrorState } from './ErrorState'

/**
 * Keeps the app shell (sidebar, top bar) usable when a module tree throws.
 * Without this, a Finance/Operations render crash takes down every route.
 */
export class ModuleRenderBoundary extends Component<
  { pathname: string; children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[module-render-boundary]', this.props.pathname, error, info.componentStack)
  }

  componentDidUpdate(prevProps: { pathname: string }) {
    if (prevProps.pathname !== this.props.pathname && this.state.hasError) {
      this.setState({ hasError: false })
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <ErrorState
          title="This module failed to load"
          description="The rest of the ERP is still available. Try again, or open another module from the sidebar."
          retry={() => this.setState({ hasError: false })}
        />
      )
    }
    return this.props.children
  }
}
