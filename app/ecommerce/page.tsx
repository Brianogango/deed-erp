import { redirect } from 'next/navigation'
import { getServerSession } from '@/lib/auth/server'
import { listPublicUsers } from '@/lib/auth/users-repository'
import { loadAppState } from '@/lib/server-store'
import { appStateKeysForRoute } from '@/lib/app-state-hydration'
import AppShell from '@/components/AppShell'
import Ecommerce from '@/components/modules/Ecommerce'

export default async function EcommercePage() {
  const session = await getServerSession()
  if (!session?.user) redirect('/login')

  const [users, serverState] = await Promise.all([
    listPublicUsers(),
    Promise.resolve(loadAppState(appStateKeysForRoute('/ecommerce'))),
  ])

  return (
    <AppShell initialUser={session.user} initialUsers={users} serverState={serverState}>
      <Ecommerce />
    </AppShell>
  )
}
