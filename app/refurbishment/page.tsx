import dynamic from 'next/dynamic'
import { ModuleSkeleton } from '@/components/ui'
const Refurbishment = dynamic(() => import('@/components/modules/Refurbishment'), { loading: () => <ModuleSkeleton />, ssr: false })
export default function RefurbishmentPage() { return <Refurbishment /> }
