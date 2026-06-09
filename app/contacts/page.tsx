import dynamic from 'next/dynamic'
import { ModuleSkeleton } from '@/components/ui'
const Contacts = dynamic(() => import('@/components/modules/Contacts'), { loading: () => <ModuleSkeleton />, ssr: false })
export default function ContactsPage() { return <Contacts /> }
