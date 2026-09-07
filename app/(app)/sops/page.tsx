import dynamic from 'next/dynamic'
import { ModuleSkeleton } from '@/components/ui/ModuleSkeleton'
const SOPs = dynamic(() => import('@/components/modules/SOPs'), { loading: () => <ModuleSkeleton />, ssr: false })
export default function SOPsPage() { return <SOPs /> }
