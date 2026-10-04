'use client'

import dynamic from 'next/dynamic'
import { ModuleSkeleton } from '@/components/ui/ModuleSkeleton'
const MyWork = dynamic(() => import('@/components/modules/MyWork'), { loading: () => <ModuleSkeleton />, ssr: false })
export default function MyWorkPage() { return <MyWork /> }
