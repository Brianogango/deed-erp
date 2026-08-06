#!/usr/bin/env node
/**
 * Backfill delivery_notes from deed_deliveries blob (dual-write cutover).
 *
 * Usage (on Contabo app host):
 *   cd /var/www/deed-erp && node scripts/backfill-deliveries-to-prisma.mjs
 *
 * Safe to re-run (upsert by blobId). Never deletes the blob.
 */
require('dotenv').config({ path: '.env' })

async function main() {
  const { loadAppState } = await import('../lib/server-store.ts').catch(async () => {
    // Compiled / tsx path
    return import('../lib/server-store.js')
  }).catch(() => null)

  // Prefer prisma + raw SQL via tsx/ts-node when available
  const { PrismaClient } = require('@prisma/client')
  const { createHash } = require('crypto')
  const prisma = new PrismaClient()

  const { Pool } = require('pg')
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })

  const { rows } = await pool.query(
    `SELECT value FROM app_state WHERE key = 'deed_deliveries' LIMIT 1`,
  )
  const raw = rows[0]?.value
  if (!raw) {
    console.log('No deed_deliveries blob found')
    process.exit(0)
  }
  const deliveries = JSON.parse(raw)
  if (!Array.isArray(deliveries)) {
    console.error('deed_deliveries is not an array')
    process.exit(1)
  }

  console.log(`Backfilling ${deliveries.length} deliveries…`)

  // Dynamic import of TS mirror via child process with npx tsx when available
  const { spawnSync } = require('child_process')
  const payload = JSON.stringify(deliveries)
  const runner = `
    const { mirrorDeliveriesToPrisma } = require('./lib/inventory/delivery-mirror.ts');
  `

  // Inline minimal upsert using Prisma for environments without tsx
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  function uuidFromKey(namespace, key) {
    const h = createHash('md5').update(`${namespace}:${key}`).digest('hex')
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`
  }
  function asUuid(v) {
    const s = String(v ?? '').trim()
    return UUID_RE.test(s) ? s : null
  }

  const products = new Set((await prisma.product.findMany({ select: { id: true } })).map(p => p.id))
  const clients = new Set((await prisma.client.findMany({ select: { id: true } })).map(c => c.id))
  const saleOrders = new Set((await prisma.saleOrder.findMany({ select: { id: true } })).map(s => s.id))
  const users = new Set((await prisma.user.findMany({ select: { id: true } })).map(u => u.id))

  let ok = 0
  let fail = 0
  for (const r of deliveries) {
    const blobId = String(r?.id ?? '').trim()
    if (!blobId) continue
    try {
      const saleOrderId = asUuid(r.saleOrderId) && saleOrders.has(r.saleOrderId) ? r.saleOrderId : null
      const clientId = asUuid(r.customerId) && clients.has(r.customerId) ? r.customerId : null
      const id = UUID_RE.test(blobId) ? blobId : uuidFromKey('delivery', blobId)
      const lines = Array.isArray(r.lines) ? r.lines : []
      await prisma.$transaction(async tx => {
        const existing = await tx.deliveryNote.findFirst({
          where: { OR: [{ blobId }, { id }] },
          select: { id: true },
        })
        const dnId = existing?.id ?? id
        const header = {
          blobId,
          dnNumber: String(r.ref || blobId).slice(0, 30),
          saleOrderId,
          clientId,
          saleOrderRef: r.saleOrderRef ? String(r.saleOrderRef).slice(0, 40) : null,
          customerName: r.customerName ? String(r.customerName).slice(0, 200) : null,
          status: String(r.status || 'waiting').slice(0, 30),
          deliveryDate: r.date ? new Date(r.date) : null,
          deliveryAddress: r.deliveryAddress || null,
          recipientName: r.recipientName ? String(r.recipientName).slice(0, 150) : null,
          recipientPhone: r.recipientPhone ? String(r.recipientPhone).slice(0, 20) : null,
          recipientIdNumber: r.recipientIdNumber ? String(r.recipientIdNumber).slice(0, 40) : null,
          notes: r.notes || null,
          warrantyCreated: Boolean(r.warrantyCreated),
          preparedAt: r.preparedAt ? new Date(r.preparedAt) : null,
          preparedById: asUuid(r.preparedByUserId) && users.has(r.preparedByUserId) ? r.preparedByUserId : null,
          createdById: asUuid(r.preparedByUserId) && users.has(r.preparedByUserId) ? r.preparedByUserId : null,
        }
        if (existing) {
          await tx.deliveryNote.update({ where: { id: dnId }, data: header })
          await tx.deliveryNoteItem.deleteMany({ where: { dnId } })
        } else {
          await tx.deliveryNote.create({ data: { id: dnId, ...header } })
        }
        if (lines.length) {
          await tx.deliveryNoteItem.createMany({
            data: lines.map((line, idx) => {
              const serialIds = Array.isArray(line.serialIds) ? line.serialIds.map(String).filter(Boolean) : []
              const productId = asUuid(line.productId) && products.has(line.productId) ? line.productId : null
              return {
                id: uuidFromKey('dn-line', `${blobId}:${idx}`),
                dnId,
                productId,
                productName: line.productName ? String(line.productName).slice(0, 200) : null,
                description: line.productName ? String(line.productName) : null,
                qty: Math.max(0, Number(line.qty) || 0),
                qtyDone: Math.max(0, Number(line.qtyDone) || 0),
                serialIds,
                serialNumberId: serialIds.find(s => UUID_RE.test(s)) || null,
                sourceLocation: line.sourceLocation ? String(line.sourceLocation).slice(0, 40) : null,
                lineOrder: idx,
              }
            }),
          })
        }
      })
      ok++
    } catch (e) {
      fail++
      console.error('fail', blobId, e.message)
    }
  }

  const count = await prisma.deliveryNote.count()
  console.log(JSON.stringify({ mirrored: ok, failed: fail, prismaDeliveryNotes: count, blobCount: deliveries.length }))
  await prisma.$disconnect()
  await pool.end()
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
