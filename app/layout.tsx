import './globals.css'
import type { Metadata } from 'next'
import { getServerSession } from '@/lib/auth/server'
import { listPublicUsers } from '@/lib/auth/users-repository'
import { loadAppState } from '@/lib/server-store'
import { appStateKeysForRoute } from '@/lib/app-state-hydration'
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

  // Unauthenticated routes (login, portal, track) render without AppShell.
  if (!session?.user) {
    return (
      <html lang="en">
        <body className="bg-[#F4F6FA] text-[#111827] antialiased overflow-hidden selection:bg-[var(--ink-navy)] selection:text-white">
          {children}
        </body>
      </html>
    )
  }

  // Authenticated — fetch in parallel then render once.
  // On subsequent navigations the server re-runs this, but the CLIENT-SIDE
  // AppProvider is preserved (not remounted), so serverState is only used
  // on the very first mount.
  const [users, serverState] = await Promise.all([
    listPublicUsers(),
    loadAppState(appStateKeysForRoute('/')),
  ])

  return (
    <html lang="en">
      <body className="bg-[#F4F6FA] text-[#111827] antialiased overflow-hidden selection:bg-[var(--ink-navy)] selection:text-white">
        <AppShell initialUser={session.user} initialUsers={users} serverState={serverState}>
          {children}
        </AppShell>
      </body>
    </html>
  )
}
