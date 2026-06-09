import dynamic from 'next/dynamic'
import ModuleSkeleton from '@/components/ui/ModuleSkeleton'
const Settings = dynamic(() => import('@/components/modules/Settings'), { loading: () => <ModuleSkeleton />, ssr: false })
export default function SettingsPage() { return <Settings /> }
