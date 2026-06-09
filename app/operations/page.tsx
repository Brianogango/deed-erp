import dynamic from 'next/dynamic'
import { ModuleSkeleton } from '@/components/ui'
const Inventory = dynamic(() => import('@/components/modules/Inventory'), { loading: () => <ModuleSkeleton />, ssr: false })
export default function OperationsPage() { return <Inventory /> }
