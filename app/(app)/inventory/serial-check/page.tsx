'use client'

import dynamic from 'next/dynamic'
import { ModuleSkeleton } from '@/components/ui/ModuleSkeleton'
const SerialCountCheck = dynamic(() => import('@/components/modules/inventory/SerialCountCheck'), { loading: () => <ModuleSkeleton />, ssr: false })
export default function SerialCheckPage() { return <SerialCountCheck /> }
