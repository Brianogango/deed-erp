import { ModuleSkeleton } from '@/components/ui/ModuleSkeleton'

/** Content-only loader — AppShell sidebar/topbar stay mounted during soft nav. */
export default function AppLoading() {
  return <ModuleSkeleton />
}
