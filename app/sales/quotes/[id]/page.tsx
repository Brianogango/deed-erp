import dynamic from 'next/dynamic'
import { ModuleSkeleton } from '@/components/ui'

const SalesQuoteDetail = dynamic(() => import('@/components/modules/SalesQuoteDetail'), {
  loading: () => <ModuleSkeleton />,
  ssr: false,
})

export default function SalesQuoteDetailPage() {
  return <SalesQuoteDetail />
}
