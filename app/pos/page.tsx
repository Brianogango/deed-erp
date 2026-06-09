import dynamic from 'next/dynamic'
import { ModuleSkeleton } from '@/components/ui'
const POS = dynamic(() => import('@/components/modules/POS'), { loading: () => <ModuleSkeleton />, ssr: false })
export default function POSPage() { return <POS /> }
