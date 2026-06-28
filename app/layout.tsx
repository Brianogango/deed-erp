import './globals.css'
import type { Metadata } from 'next'
import { getServerSession } from '@/lib/auth/server'
import { listPublicUsers } from '@/lib/auth/users-repository'
import { PUBLIC_USERS } from '@/lib/auth/public-users'
import { loadAppState } from '@/lib/server-store'
import AppShell from '@/components/AppShell'

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
      <html lang="en">
        <body className="bg-[#F4F6FA] text-[#111827] antialiased overflow-hidden selection:bg-[#1B2762] selection:text-white">
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
    <html lang="en">
      <body className="bg-[#F4F6FA] text-[#111827] antialiased overflow-hidden selection:bg-[#1B2762] selection:text-white">
        <AppShell initialUser={shellUser} initialUsers={users} serverState={serverState}>
          {children}
        </AppShell>
      </body>
    </html>
  )
}
