import { Suspense } from 'react'
import dynamic from 'next/dynamic'
import { ModuleSkeleton } from '@/components/ui/ModuleSkeleton'

const Inventory = dynamic(() => import('@/components/modules/Inventory'), {
  loading: () => <ModuleSkeleton label="Inventory" />,
  ssr: false,
})

export default function InventoryPage() {
  return (
    <Suspense fallback={<ModuleSkeleton label="Inventory" />}>
      <Inventory />
    </Suspense>
  )
}
