import { redirect } from 'next/navigation'
import { getServerSession } from '@/lib/auth/server'
import type { PublicUser } from '@/lib/auth/types'
import { MODULE_IDS } from '@/lib/auth/types'
import AppShell from '@/components/AppShell'

/**
 * Persistent authenticated shell. This layout stays mounted across module
 * navigations — only `{children}` (the module page) swaps. Session is a cookie
 * decode; store data hydrates on the client so this layout does not block on
 * a full app_state read.
 */
/** Local screenshots only (VISREG_BYPASS_AUTH, never in production): one Director, no data. */
const VISUAL_REGRESSION_USER: PublicUser = {
  id: 'visreg', username: 'visreg', name: 'Visual Check', role: 'director',
  modules: [...MODULE_IDS], active: true, createdAt: '2026-01-01',
}

export default async function AppGroupLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession()
  const visregBypassAuth =
    process.env.NODE_ENV !== 'production' &&
    process.env.VISREG_BYPASS_AUTH === 'true'

  if (!session?.user && !visregBypassAuth) {
    redirect('/login')
  }

  const shellUser = session?.user ?? VISUAL_REGRESSION_USER
  const initialUsers = [shellUser]

  return (
    <AppShell initialUser={shellUser} initialUsers={initialUsers} serverState={{}}>
      {children}
    </AppShell>
  )
}
