'use client'

import { Suspense } from 'react'
import dynamic from 'next/dynamic'
import { ModuleSkeleton } from '@/components/ui/ModuleSkeleton'
import SalesListPagination from '@/components/modules/sales/SalesListPagination'

const Sales = dynamic(() => import('@/components/modules/Sales'), { loading: () => <ModuleSkeleton />, ssr: false })

export default function SalesPage() {
  return (
    <>
      <Sales />
      <Suspense fallback={null}>
        <SalesListPagination />
      </Suspense>
    </>
  )
}
