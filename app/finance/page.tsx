import dynamic from 'next/dynamic'
import ModuleSkeleton from '@/components/ui/ModuleSkeleton'
const Accounting = dynamic(() => import('@/components/modules/Accounting'), { loading: () => <ModuleSkeleton />, ssr: false })
export default function FinancePage() { return <Accounting /> }
