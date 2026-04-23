import { redirect } from 'next/navigation'

import LoginScreen from '@/components/auth/LoginScreen'
import { getServerSession } from '@/lib/auth/server'

export default async function LoginPage() {
  const session = await getServerSession()

  if (session?.user) {
    redirect('/')
  }

  return <LoginScreen />
}
