'use client'

import dynamic from 'next/dynamic'
import { Suspense } from 'react'
import { ModuleSkeleton } from '@/components/ui/ModuleSkeleton'
const DeliverHeldUnits = dynamic(() => import('@/components/sales/DeliverHeldUnits'), { loading: () => <ModuleSkeleton />, ssr: false })
export default function DeliverHeldPage() { return <Suspense fallback={<ModuleSkeleton />}><DeliverHeldUnits /></Suspense> }
