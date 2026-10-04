'use client'

import dynamic from 'next/dynamic'
import { ModuleSkeleton } from '@/components/ui/ModuleSkeleton'
const RecurringBills = dynamic(() => import('@/components/modules/RecurringBills'), { loading: () => <ModuleSkeleton />, ssr: false })
export default function RecurringBillsPage() { return <RecurringBills /> }
