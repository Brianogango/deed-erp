import dynamic from 'next/dynamic'
import { ModuleSkeleton } from '@/components/ui'
const Sales = dynamic(() => import('@/components/modules/Sales'), { loading: () => <ModuleSkeleton />, ssr: false })
export default function SalesPage() { return <Sales /> }
