import type { Metadata, Viewport } from 'next'
import './globals.css'
import { StoreProvider } from '../providers/StoreProvider'
import SwRegister from '@/components/SwRegister'

export const metadata: Metadata = {
  title: 'Deed ERP',
  description: 'Deed Technologies — Business Management Platform',
  manifest: '/manifest.json',
}

export const viewport: Viewport = {
  themeColor: '#0f172a',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <StoreProvider>
          {children}
        </StoreProvider>
        <SwRegister />
      </body>
    </html>
  )
}
