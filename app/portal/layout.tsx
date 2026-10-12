import type { Metadata } from 'next'

// Client-facing pages: named for the company, not the internal ERP (this is
// what link previews in WhatsApp and email show).
export const metadata: Metadata = {
  title: 'Deed Technologies',
  description: 'Deed Technologies customer portal',
  applicationName: 'Deed Technologies',
}

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return children
}
