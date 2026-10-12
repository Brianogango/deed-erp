import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Credit Account Application — Deed Technologies',
  description: 'Complete your Deed Technologies credit account application and upload the required documents.',
}

export default function CreditApplicationLayout({ children }: { children: React.ReactNode }) {
  return children
}
