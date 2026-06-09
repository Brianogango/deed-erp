import dynamic from 'next/dynamic'
import { ModuleSkeleton } from '@/components/ui'
const Dashboard = dynamic(() => import('@/components/modules/Dashboard'), { loading: () => <ModuleSkeleton />, ssr: false })
export default function HomePage() { return <Dashboard /> }
