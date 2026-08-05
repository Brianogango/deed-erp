import type { Prisma } from '@prisma/client'
import { uuidFromKey } from '@/lib/accounting/ids'

type Tx = Prisma.TransactionClient

/**
 * Adjust (or create) a StockLevel row. Missing rows are a data-integrity gap —
 * we create them with the applied deltas and never swallow errors (DB-003).
 */
export async function adjustStockLevel(
  tx: Tx,
  productId: string,
  deltas: { onHand?: number; reserved?: number },
): Promise<void> {
  const onHandDelta = Number(deltas.onHand ?? 0)
  const reservedDelta = Number(deltas.reserved ?? 0)
  if (onHandDelta === 0 && reservedDelta === 0) return

  const existing = await tx.stockLevel.findUnique({ where: { productId } })
  if (existing) {
    await tx.stockLevel.update({
      where: { productId },
      data: {
        qtyOnHand: Math.max(0, existing.qtyOnHand + onHandDelta),
        qtyReserved: Math.max(0, existing.qtyReserved + reservedDelta),
      },
    })
    return
  }

  try {
    await tx.stockLevel.create({
      data: {
        id: uuidFromKey('stock_level', productId),
        productId,
        qtyOnHand: Math.max(0, onHandDelta),
        qtyReserved: Math.max(0, reservedDelta),
      },
    })
    console.warn(`[stock] created missing StockLevel for product ${productId}`)
  } catch (err) {
    console.error(`[stock] failed to create StockLevel for product ${productId}:`, err)
    throw err
  }
}

/** Create a zero StockLevel for a newly published product (same transaction). */
export async function createZeroStockLevel(tx: Tx, productId: string): Promise<void> {
  await tx.stockLevel.create({
    data: {
      id: uuidFromKey('stock_level', productId),
      productId,
      qtyOnHand: 0,
      qtyReserved: 0,
      qtyOnOrder: 0,
    },
  })
}
