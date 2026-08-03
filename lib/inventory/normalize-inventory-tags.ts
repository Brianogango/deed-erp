/**
 * Rewrite legacy INV-* inventory tags (looked like invoice numbers) to the
 * manufacturer serial — the tag is the serial only.
 */

import 'server-only'
import prisma from '@/lib/prisma'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import { rewriteInventoryTags } from '@/lib/inventory-identifiers'

export type NormalizeInventoryTagsResult = {
  rewritten: number
  total: number
  serials: Array<Record<string, unknown>>
}

export async function normalizeInventoryTags(): Promise<NormalizeInventoryTagsResult> {
  const state = await loadAppState(['deed_serials'])
  const serials = Array.isArray(state.deed_serials)
    ? [...(state.deed_serials as Array<Record<string, unknown>>)]
    : []

  const { rows, rewritten } = rewriteInventoryTags(serials)
  if (rewritten === 0) {
    return { rewritten: 0, total: serials.length, serials }
  }

  await saveStoreKeys({ deed_serials: JSON.stringify(rows) })

  // Best-effort Prisma mirror — blob (deed_serials) is source of truth for UI qty.
  try {
    for (const row of rows) {
      const id = String(row.id ?? '').trim()
      const barcode = String(row.barcode ?? '').trim()
      if (!id || !barcode) continue
      await prisma.serialNumber.updateMany({
        where: { id },
        data: { inventoryBarcode: barcode },
      }).catch(() => {})
    }
  } catch {
    /* Prisma mirror is optional */
  }

  return { rewritten, total: rows.length, serials: rows }
}
