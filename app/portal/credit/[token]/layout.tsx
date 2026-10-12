import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Credit Account Application — Deed Technologies',
  description: 'Complete your Deed Technologies credit account application and upload the required documents.',
  // The link is the key to the application: never indexed, never sent on to other sites.
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

export default function CreditApplicationLayout({ children }: { children: React.ReactNode }) {
  return children
}
