import dynamic from 'next/dynamic'
import ModuleSkeleton from '@/components/ui/ModuleSkeleton'
const HR = dynamic(() => import('@/components/modules/HR'), { loading: () => <ModuleSkeleton />, ssr: false })
export default function HRPage() { return <HR /> }
