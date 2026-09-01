import './globals.css'
import '@/components/modules/odoo-record-designs.css'
import '@/components/erp/mobile-operational.css'
import type { Metadata, Viewport } from 'next'
import { getServerSession } from '@/lib/auth/server'
import { listPublicUsers } from '@/lib/auth/users-repository'
import { PUBLIC_USERS } from '@/lib/auth/public-users'
import { loadAppState } from '@/lib/server-store'
import AppShell from '@/components/AppShell'
import SwRegister from '@/components/SwRegister'
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

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession()
  const visregBypassAuth =
    process.env.NODE_ENV !== 'production' &&
    process.env.VISREG_BYPASS_AUTH === 'true'

  if (!session?.user && !visregBypassAuth) {
    return (
      <html lang="en" className={htmlClassName}>
        <body className={bodyClassName}>
          <SwRegister />
          {children}
        </body>
      </html>
    )
  }

  const fallbackUser = PUBLIC_USERS.find(user => user.username === 'brian') ?? PUBLIC_USERS[0]
  const shellUser = session?.user ?? fallbackUser
  const bootstrapKeys = [
    'deed_companySettings',
    'deed_systemSettings',
    'deed_profileImages',
  ]
  const [users, serverState] = visregBypassAuth
    ? [PUBLIC_USERS, {}]
    : await Promise.all([
        listPublicUsers(),
        loadAppState(bootstrapKeys),
      ])

  return (
    <html lang="en" className={htmlClassName}>
      <body className={bodyClassName}>
        <SwRegister />
        <AppShell initialUser={shellUser} initialUsers={users} serverState={serverState}>
          {children}
        </AppShell>
      </body>
    </html>
  )
}
