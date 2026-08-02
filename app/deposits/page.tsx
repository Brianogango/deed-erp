import dynamic from 'next/dynamic'
import { ModuleSkeleton } from '@/components/ui/ModuleSkeleton'
const Deposits = dynamic(() => import('@/components/modules/Deposits'), { loading: () => <ModuleSkeleton />, ssr: false })
export default function DepositsPage() { return <Deposits /> }
