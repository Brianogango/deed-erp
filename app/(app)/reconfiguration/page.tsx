'use client'

import dynamic from 'next/dynamic'
import { ModuleSkeleton } from '@/components/ui/ModuleSkeleton'
const Reconfiguration = dynamic(() => import('@/components/modules/Reconfiguration'), {
  loading: () => <ModuleSkeleton />,
  ssr: false,
})
export default function ReconfigurationPage() {
  return <Reconfiguration />
}
