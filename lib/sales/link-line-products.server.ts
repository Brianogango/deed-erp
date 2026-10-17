import 'server-only'
import prisma from '@/lib/prisma'
import { optionalUuid } from '@/lib/legacy-compat'
import { isSaleOrderSectionLine } from '@/lib/sale-order-items-write'

const normalize = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase()

/**
 * Lines saved without a product cannot be stock-checked, delivered or posted to
 * a revenue category — they all land on plain Sales Revenue. When a line has no
 * product but its name is *exactly* the name of one active product, link it.
 *
 * Deliberately narrow: exact name only (case and spacing aside), and only when
 * a single active product has that name. Two products with the same name, or no
 * match, leave the line as it is — a wrong link is worse than none.
 */
export async function linkLinesToProducts<T extends Record<string, any>>(lines: T[]): Promise<T[]> {
  const wanted = new Map<string, string>()
  for (const line of lines) {
    if (!line || isSaleOrderSectionLine(line)) continue
    if (optionalUuid(line.productId)) continue
    const key = normalize(line.productName ?? line.description)
    if (key) wanted.set(key, String(line.productName ?? line.description).replace(/\s+/g, ' ').trim())
  }
  if (!wanted.size) return lines

  let candidates: Array<{ id: string; name: string }>
  try {
    candidates = await prisma.product.findMany({
      where: {
        isActive: true,
        OR: [...wanted.values()].slice(0, 60).map(name => ({ name: { equals: name, mode: 'insensitive' as const } })),
      },
      select: { id: true, name: true },
    })
  } catch (error) {
    // An improvement, never a reason to refuse to save the order.
    console.warn('[sale-orders] could not link lines to products:', error instanceof Error ? error.message : error)
    return lines
  }
  const byName = new Map<string, string[]>()
  for (const product of candidates) {
    const key = normalize(product.name)
    byName.set(key, [...(byName.get(key) ?? []), product.id])
  }

  return lines.map(line => {
    if (!line || isSaleOrderSectionLine(line) || optionalUuid(line.productId)) return line
    const ids = byName.get(normalize(line.productName ?? line.description))
    return ids && ids.length === 1 ? { ...line, productId: ids[0] } : line
  })
}
