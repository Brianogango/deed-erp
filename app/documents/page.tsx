import dynamic from 'next/dynamic'
import { ModuleSkeleton } from '@/components/ui'
const MyDocuments = dynamic(() => import('@/components/modules/MyDocuments'), { loading: () => <ModuleSkeleton />, ssr: false })
export default function DocumentsPage() { return <MyDocuments /> }
