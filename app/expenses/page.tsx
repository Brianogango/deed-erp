import dynamic from 'next/dynamic'
import ModuleSkeleton from '@/components/ui/ModuleSkeleton'
const Expenses = dynamic(() => import('@/components/modules/Expenses'), { loading: () => <ModuleSkeleton />, ssr: false })
export default function ExpensesPage() { return <Expenses /> }
