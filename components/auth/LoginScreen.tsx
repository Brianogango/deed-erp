import { Suspense } from 'react'
import SecureLogin from '@/components/auth/SecureLogin'
import { PortalPageSkeleton } from '@/components/auth/AuthFeedback'

export default function LoginScreen() {
  return (
    <Suspense fallback={<PortalPageSkeleton label="Loading secure sign-in…" />}>
      <SecureLogin />
    </Suspense>
  )
}
