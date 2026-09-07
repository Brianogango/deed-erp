import { ModuleSkeleton } from '@/components/ui/ModuleSkeleton'

/** Segment fallback while the inventory chunk mounts (`ssr: false`). */
export default function InventoryLoading() {
  return <ModuleSkeleton label="Inventory" />
}
