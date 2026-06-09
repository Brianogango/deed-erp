import dynamic from 'next/dynamic'
import { ModuleSkeleton } from '@/components/ui'
const Delivery = dynamic(() => import('@/components/modules/Delivery'), { loading: () => <ModuleSkeleton />, ssr: false })
export default function DeliveryPage() { return <Delivery /> }
