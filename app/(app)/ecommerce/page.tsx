'use client'

import dynamic from 'next/dynamic'
import { ModuleSkeleton } from '@/components/ui/ModuleSkeleton'
const Ecommerce = dynamic(() => import('@/components/modules/Ecommerce'), { loading: () => <ModuleSkeleton />, ssr: false })
export default function EcommercePage() { return <Ecommerce /> }
