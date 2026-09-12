'use client'

import dynamic from 'next/dynamic'
import { ModuleSkeleton } from '@/components/ui/ModuleSkeleton'
const Purchase = dynamic(() => import('@/components/modules/Purchase'), { loading: () => <ModuleSkeleton />, ssr: false })
export default function PurchasesPage() { return <Purchase /> }
