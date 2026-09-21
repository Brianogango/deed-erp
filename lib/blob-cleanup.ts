import 'server-only'
import prisma from '@/lib/prisma'
import { listObjects, deleteObject } from '@/lib/infra/object-store'
import { loadAppState } from '@/lib/server-store'

export type BlobCleanupResult = {
  total: number
  orphaned: string[]
  deleted: string[]
  errors: string[]
}

function blobObjectKey(key: string) {
  return key.replace(/[^A-Za-z0-9_.-]/g, '_')
}

export async function cleanupOrphanedBlobs(opts?: { dryRun?: boolean }): Promise<BlobCleanupResult> {
  const dryRun = opts?.dryRun !== false
  const result: BlobCleanupResult = { total: 0, orphaned: [], deleted: [], errors: [] }

  try {
    const allKeys = await listObjects('blobs')
    result.total = allKeys.length

    const repairs = await prisma.repair.findMany({ select: { jobNumber: true } })
    const repairRefsSanitized = new Set(repairs.map(r => blobObjectKey(r.jobNumber)))

    const products = await prisma.product.findMany({ select: { id: true } })
    const productIdsSanitized = new Set(products.map(p => blobObjectKey(p.id)))

    const state = await loadAppState(['deed_expenses'])
    const expenses: any[] = Array.isArray(state.deed_expenses) ? state.deed_expenses : []
    const expenseIdsSanitized = new Set(
      expenses.map((e: any) => String(e?.id ?? '')).filter(Boolean).map(blobObjectKey),
    )

    for (const key of allKeys) {
      let isOrphan = false

      if (key.startsWith('repair_photos_') || key.startsWith('repair_payment_proof_')) {
        const prefix = key.startsWith('repair_photos_') ? 'repair_photos_' : 'repair_payment_proof_'
        isOrphan = !repairRefsSanitized.has(key.slice(prefix.length))
      } else if (key.startsWith('product_photos_')) {
        isOrphan = !productIdsSanitized.has(key.slice('product_photos_'.length))
      } else if (key.startsWith('expense_receipt_')) {
        isOrphan = !expenseIdsSanitized.has(key.slice('expense_receipt_'.length))
      }

      if (isOrphan) {
        result.orphaned.push(key)
        if (!dryRun) {
          try {
            await deleteObject('blobs', key)
            result.deleted.push(key)
          } catch (err) {
            result.errors.push(`${key}: ${err instanceof Error ? err.message : String(err)}`)
          }
        }
      }
    }
  } catch (err) {
    result.errors.push(`scan failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  return result
}
