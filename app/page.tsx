import { redirect } from 'next/navigation'

import AppShell from '@/components/AppShell'
import { getServerSession } from '@/lib/auth/server'
import { listPublicUsers } from '@/lib/auth/users-repository'
import { loadAppState } from '@/lib/server-store'

export default async function Page() {
  const session = await getServerSession()

  if (!session?.user) {
    redirect('/login')
  }

  const users = await listPublicUsers()
  const serverState = loadAppState()

  return <AppShell initialUser={session.user} initialUsers={users} serverState={serverState} />
}
