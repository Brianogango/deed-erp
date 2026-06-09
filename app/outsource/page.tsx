import dynamic from 'next/dynamic'
import { ModuleSkeleton } from '@/components/ui'
const Outsource = dynamic(() => import('@/components/modules/Outsource'), { loading: () => <ModuleSkeleton />, ssr: false })
export default function OutsourcePage() { return <Outsource /> }
