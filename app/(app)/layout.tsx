import { redirect } from 'next/navigation'
import { getServerSession } from '@/lib/auth/server'
import { PUBLIC_USERS } from '@/lib/auth/public-users'
import AppShell from '@/components/AppShell'

/**
 * Persistent authenticated shell. This layout stays mounted across module
 * navigations — only `{children}` (the module page) swaps. Session is a cookie
 * decode; store data hydrates on the client so this layout does not block on
 * a full app_state read.
 */
export default async function AppGroupLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession()
  const visregBypassAuth =
    process.env.NODE_ENV !== 'production' &&
    process.env.VISREG_BYPASS_AUTH === 'true'

  if (!session?.user && !visregBypassAuth) {
    redirect('/login')
  }

  const fallbackUser = PUBLIC_USERS.find(user => user.username === 'brian') ?? PUBLIC_USERS[0]
  const shellUser = session?.user ?? fallbackUser
  const initialUsers = visregBypassAuth ? PUBLIC_USERS : [shellUser]

  return (
    <AppShell initialUser={shellUser} initialUsers={initialUsers} serverState={{}}>
      {children}
    </AppShell>
  )
}
