import dynamic from 'next/dynamic'
import { ModuleSkeleton } from '@/components/ui'
const Holdovers = dynamic(() => import('@/components/modules/Holdovers'), { loading: () => <ModuleSkeleton />, ssr: false })
export default function HoldoversPage() { return <Holdovers /> }
