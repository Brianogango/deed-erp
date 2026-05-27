import { redirect } from 'next/navigation'
import { getServerSession } from '@/lib/auth/server'
import { listPublicUsers } from '@/lib/auth/users-repository'
import { loadAppState } from '@/lib/server-store'
import AppShell from '@/components/AppShell'
import Deposits from '@/components/modules/Deposits'

export default async function DepositsPage() {
  const session = await getServerSession()
  if (!session) redirect('/login')

  const [users, serverState] = await Promise.all([
    listPublicUsers(),
    Promise.resolve(loadAppState()),
  ])

  return (
    <AppShell initialUser={session.user} initialUsers={users} serverState={serverState}>
      <Deposits />
    </AppShell>
  )
}
