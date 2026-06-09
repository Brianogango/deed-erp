import dynamic from 'next/dynamic'
import { ModuleSkeleton } from '@/components/ui'
const AfterSales = dynamic(() => import('@/components/modules/AfterSales'), { loading: () => <ModuleSkeleton />, ssr: false })
export default function AfterSalesPage() { return <AfterSales /> }
