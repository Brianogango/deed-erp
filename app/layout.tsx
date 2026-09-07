import './globals.css'
import '@/components/modules/odoo-record-designs.css'
import '@/components/erp/mobile-operational.css'
import '@/components/erp/mobile-chrome.css'
import '@/components/erp/overlay-stacking.css'
import '@/components/erp/inventory-stock-row-alignment.css'
import type { Metadata, Viewport } from 'next'
import SwRegister from '@/components/SwRegister'
import ClientStoreShapeGuard from '@/components/ClientStoreShapeGuard'
import VersionDriftBanner from '@/components/layout/VersionDriftBanner'
import { getServerBuildId } from '@/lib/app-version'
import { robotoFlex, openSans, dmMono } from './fonts'

export const metadata: Metadata = {
  title: 'Deed ERP',
  description: 'Deed Digital Solutions — Enterprise Resource Planning',
  manifest: '/manifest.json',
  applicationName: 'Deed ERP',
  appleWebApp: {
    capable: true,
    title: 'Deed ERP',
    statusBarStyle: 'default',
  },
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/icon-32x32.png', type: 'image/png', sizes: '32x32' },
      { url: '/icon-16x16.png', type: 'image/png', sizes: '16x16' },
    ],
    apple: '/icon-apple-touch.png',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#20164d',
}

const htmlClassName = `${robotoFlex.variable} ${openSans.variable} ${dmMono.variable}`
const bodyClassName = 'bg-bg text-t1 antialiased overflow-hidden selection:bg-navy-500 selection:text-white'

/**
 * Root layout is a stable html/body shell only. Authenticated chrome lives in
 * `app/(app)/layout.tsx` so login / track / portal do not remount AppShell,
 * and module navigations only swap `{children}`.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={htmlClassName}>
      <body className={bodyClassName} data-build={getServerBuildId()}>
        <ClientStoreShapeGuard />
        <SwRegister />
        {children}
        <VersionDriftBanner />
      </body>
    </html>
  )
}
