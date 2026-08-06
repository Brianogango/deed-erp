import type { ReactNode } from 'react'

/** Isolated layout — root layout renders without AppShell when unauthenticated. */
export default function SalesPrototypeLayout({ children }: { children: ReactNode }) {
  return children
}
