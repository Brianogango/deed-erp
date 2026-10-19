import { redirect } from 'next/navigation'
import { getServerSession } from '@/lib/auth/server'
import PasswordChangeScreen from '@/components/auth/PasswordChangeScreen'

export const dynamic = 'force-dynamic'

export default async function PasswordChangePage() {
  const session = await getServerSession()
  if (!session?.user) redirect('/login')

  // Pass only what the client needs to verify and call the update endpoint.
  return (
    <PasswordChangeScreen
      user={{
        id: session.user.id,
        username: session.user.username,
        name: session.user.name,
      }}
    />
  )
}
