'use client'

import { Suspense } from 'react'
import dynamic from 'next/dynamic'
import { ModuleSkeleton } from '@/components/ui/ModuleSkeleton'
const InvoiceDetail = dynamic(() => import('@/components/modules/InvoiceDetail'), { loading: () => <ModuleSkeleton />, ssr: false })
export default function InvoiceDetailPage() {
  return (
    <Suspense fallback={<ModuleSkeleton />}>
      <InvoiceDetail />
    </Suspense>
  )
}
