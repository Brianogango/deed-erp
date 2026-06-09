import dynamic from 'next/dynamic'
import { ModuleSkeleton } from '@/components/ui'
const Kilimall = dynamic(() => import('@/components/modules/Kilimall'), { loading: () => <ModuleSkeleton />, ssr: false })
export default function KilimallPage() { return <Kilimall /> }
