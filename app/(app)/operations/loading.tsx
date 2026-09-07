import { ModuleSkeleton } from '@/components/ui/ModuleSkeleton'

/** Shown if the legacy /operations alias suspends before the /inventory redirect. */
export default function OperationsAliasLoading() {
  return <ModuleSkeleton label="Inventory" />
}
