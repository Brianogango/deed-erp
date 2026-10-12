import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Credit Application — Deed Technologies',
  description: 'Complete your Deed Technologies credit application and upload the required documents.',
}

export default function CreditApplicationLayout({ children }: { children: React.ReactNode }) {
  return children
}
