import dynamic from 'next/dynamic'
import { ModuleSkeleton } from '@/components/ui/ModuleSkeleton'
const Refurbishment = dynamic(() => import('@/components/modules/Refurbishment'), { loading: () => <ModuleSkeleton />, ssr: false })
export default function RefurbishmentPage() { return <Refurbishment /> }
