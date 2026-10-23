import 'server-only'
import { loadAppStateForWrite, saveStoreKeys, withAppStateKeyLock } from '@/lib/server-store'

/**
 * A repair drop-off finished from the rider's link: mark the repair delivered,
 * as the office's "Delivered" button does. Without this the job showed
 * delivered while the repair still read "out for delivery".
 */
export async function markRepairDeliveredByRider(
  job: { ref: string; repairOrderId?: string; recipientName?: string; deliveredAt?: string; customerPhone?: string },
  riderName: string,
): Promise<void> {
  if (!job.repairOrderId) return
  await withAppStateKeyLock('deed_repairs_v2', async () => {
    const state = await loadAppStateForWrite(['deed_repairs_v2'])
    const repairs = Array.isArray(state.deed_repairs_v2) ? state.deed_repairs_v2 as any[] : []
    let changed = false
    const next = repairs.map(r => {
      if (r?.id !== job.repairOrderId || ['delivered', 'collected', 'closed'].includes(String(r.status))) return r
      changed = true
      return {
        ...r,
        status: 'delivered',
        deliveryActualDate: job.deliveredAt ?? new Date().toISOString(),
        deliveryRecipient: job.recipientName || r.contactPersonName || r.customerName,
        deliveryRecipientPhone: r.contactPersonPhone || r.customerPhone || job.customerPhone,
        notes: `${r.notes ? `${r.notes}\n` : ''}Delivered by rider ${riderName} (${job.ref}), received by ${job.recipientName ?? '—'}`,
      }
    })
    if (changed) await saveStoreKeys({ deed_repairs_v2: JSON.stringify(next) })
  })
}
