import './globals.css'
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
  // Deed Navy — colours the mobile browser chrome / PWA title bar.
  // Must be a literal colour: CSS var() does not resolve inside <meta theme-color>.
  themeColor: '#20164d',
}

// Font CSS variables live on <html> so Tailwind's preflight font-family
// declaration (set at the html level) can resolve them.
const htmlClassName = `${robotoFlex.variable} ${openSans.variable} ${dmMono.variable}`
// Shell surfaces use the design tokens (bg-bg = --bg-page, text-t1 = --text-1,
// selection = Deed Navy) so login/portal and the authenticated app share one palette.
const bodyClassName = 'bg-bg text-t1 antialiased overflow-hidden selection:bg-navy-500 selection:text-white'

// Root layout — mounts AppShell ONCE for authenticated sessions.
// The AppShell (and AppProvider) are Client Components that Next.js preserves
// across client-side navigations, so the store, localStorage reads, API fetches,
// and SSE connection all survive page transitions without remounting.
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession()
  const visregBypassAuth =
    process.env.NODE_ENV !== 'production' &&
    process.env.VISREG_BYPASS_AUTH === 'true'

  // Unauthenticated routes (login, portal, track) render without AppShell.
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

  // Authenticated (or visual-regression bypass mode) — fetch in parallel then render once.
  // On subsequent navigations the server re-runs this, but the CLIENT-SIDE
  // AppProvider is preserved (not remounted), so serverState is only used
  // on the very first mount.
  const fallbackUser = PUBLIC_USERS.find(user => user.username === 'brian') ?? PUBLIC_USERS[0]
  const shellUser = session?.user ?? fallbackUser
  const bootstrapKeys = [
    'deed_companySettings',
    'deed_systemSettings',
    'deed_notifications',
    'deed_profileImages',
  ]
  const [users, serverState] = visregBypassAuth
    ? [PUBLIC_USERS, {}]
    : await Promise.all([
        listPublicUsers(),
        // Keep the initial shell payload small. Module data is hydrated client-side
        // per route so the first response is not blocked by the full ERP dataset.
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
