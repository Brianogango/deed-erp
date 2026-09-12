'use client'

import dynamic from 'next/dynamic'
import { ModuleSkeleton } from '@/components/ui/ModuleSkeleton'
const CompanyProperty = dynamic(() => import('@/components/modules/CompanyProperty'), { loading: () => <ModuleSkeleton />, ssr: false })
export default function PropertyPage() { return <CompanyProperty /> }
