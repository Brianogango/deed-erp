'use client'

import { Suspense } from 'react'
import Login from '@/components/modules/Login'
import { PortalPageSkeleton } from '@/components/auth/AuthFeedback'

export default function LoginScreen() {
  return (
    <Suspense fallback={<PortalPageSkeleton label="Loading secure sign-in…" />}>
      <Login />
    </Suspense>
  )
}
