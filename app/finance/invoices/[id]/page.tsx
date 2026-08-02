import dynamic from 'next/dynamic'
import { ModuleSkeleton } from '@/components/ui/ModuleSkeleton'
const InvoiceDetail = dynamic(() => import('@/components/modules/InvoiceDetail'), { loading: () => <ModuleSkeleton />, ssr: false })
export default function InvoiceDetailPage() { return <InvoiceDetail /> }
