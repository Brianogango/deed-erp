import dynamic from 'next/dynamic'
import { ModuleSkeleton } from '@/components/ui/ModuleSkeleton'
const Repair = dynamic(() => import('@/components/modules/Repair'), { loading: () => <ModuleSkeleton />, ssr: false })
export default function RepairsPage() { return <Repair /> }
