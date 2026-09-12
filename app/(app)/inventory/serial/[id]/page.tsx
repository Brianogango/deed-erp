import { redirect } from 'next/navigation'

/**
 * QR deep-link target for serialized-device labels.
 * Lands on Inventory → Find Serial with the id/serial prefilled.
 */
export default async function InventorySerialDeepLinkPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  redirect(`/inventory?tab=reports&serial=${encodeURIComponent(id || '')}`)
}
