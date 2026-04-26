'use client'

import { Suspense } from 'react'
import Login from '@/components/modules/Login'

export default function LoginScreen() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#0A0C14]" />}>
      <Login />
    </Suspense>
  )
}
