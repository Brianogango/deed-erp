import dynamic from 'next/dynamic'
import { ModuleSkeleton } from '@/components/ui/ModuleSkeleton'

const CRM = dynamic(() => import('@/components/modules/CRM'), {
  loading: () => <ModuleSkeleton />,
  ssr: false,
})

export default function CRMPage() {
  return <CRM />
}
