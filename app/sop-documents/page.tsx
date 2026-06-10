'use client'
import dynamic from 'next/dynamic'
import { ModuleSkeleton } from '@/components/ui'

const SOPDocuments = dynamic(() => import('@/components/modules/SOPDocuments'), {
  loading: () => <ModuleSkeleton />,
  ssr: false,
})

export default function SOPDocumentsPage() {
  return <SOPDocuments />
}
