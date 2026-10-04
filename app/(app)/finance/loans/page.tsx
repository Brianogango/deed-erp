'use client'

import dynamic from 'next/dynamic'
import { ModuleSkeleton } from '@/components/ui/ModuleSkeleton'
const Loans = dynamic(() => import('@/components/modules/Loans'), { loading: () => <ModuleSkeleton />, ssr: false })
export default function LoansPage() { return <Loans /> }
