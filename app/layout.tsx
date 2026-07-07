import './globals.css'
import type { Metadata, Viewport } from 'next'
import { getServerSession } from '@/lib/auth/server'
import { listPublicUsers } from '@/lib/auth/users-repository'
import { PUBLIC_USERS } from '@/lib/auth/public-users'
import { loadInitialAppState } from '@/lib/server-store'
import AppShell from '@/components/AppShell'
import { inter, dmMono } from './fonts'

export const metadata: Metadata = {
  title: 'Deed ERP',
  description: 'Deed Digital Solutions — Enterprise Resource Planning',
  icons: {
    icon: [
      { url: '/deed-logo.svg', type: 'image/svg+xml' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: '/icon-192.png',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Deed Navy — colours the mobile browser chrome / PWA title bar.
  themeColor: 'var(--navy)',
}

// Font CSS variables live on <html> so Tailwind's preflight font-family
// declaration (set at the html level) can resolve them.
const htmlClassName = `${inter.variable} ${dmMono.variable}`
// Shell surfaces use the design tokens (bg-bg = --bg-page, text-t1 = --text-1,
// selection = Deed Navy) so login/portal and the authenticated app share one palette.
const bodyClassName = 'bg-bg text-t1 antialiased overflow-hidden selection:bg-navy-500 selection:text-white'

// Root layout — mounts AppShell ONCE for authenticated sessions.
// The AppShell (and AppProvider) are Client Components that Next.js preserves
// across client-side navigations, so the store, localStorage reads, API fetches,
// and SSE connection all survive page transitions without remounting.
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession()
  const visregBypassAuth = process.env.VISREG_BYPASS_AUTH === 'true'

  // Unauthenticated routes (login, portal, track) render without AppShell.
  if (!session?.user && !visregBypassAuth) {
    return (
      <html lang="en" className={htmlClassName}>
        <body className={bodyClassName}>
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
  const [users, serverState] = visregBypassAuth
    ? [PUBLIC_USERS, {}]
    : await Promise.all([
        listPublicUsers(),
        // Load the full app-state snapshot once at shell boot. The ERP navigates
        // between modules inside this preserved shell, so route-scoped hydration can
        // make data appear missing after a browser cache reset.
        loadInitialAppState(),
      ])

  return (
    <html lang="en" className={htmlClassName}>
      <body className={bodyClassName}>
        <AppShell initialUser={shellUser} initialUsers={users} serverState={serverState}>
          {children}
        </AppShell>
      </body>
    </html>
  )
}
