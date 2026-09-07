import { redirect } from 'next/navigation'

/**
 * QR deep-link target for serialized-device labels.
 * Lands on Inventory → Find Serial with the id/serial prefilled.
 */
export default function InventorySerialDeepLinkPage({
  params,
}: {
  params: { id: string }
}) {
  const id = encodeURIComponent(params.id || '')
  redirect(`/inventory?tab=reports&serial=${id}`)
}
