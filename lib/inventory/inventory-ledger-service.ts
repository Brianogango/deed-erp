import 'server-only'
import type { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import { createJournalEntryInTx } from '@/lib/accounting/journal-service'
import { labelForRole } from '@/lib/accounting/coa-roles'
import { writeFinancialAuditInTx } from '@/lib/finance-audit'

const money = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100
const qtyInt = (n: unknown) => Math.max(0, Math.trunc(Number(n) || 0))

async function consumeCost(tx: Prisma.TransactionClient, productId: string, qty: number) {
  const product = await tx.product.findUnique({
    where: { id: productId },
    select: { costingMethod: true, costPrice: true },
  })
  if (!product) throw new Error(`Product not found in relational inventory: ${productId}`)
  const valuation = await tx.productValuation.findUnique({ where: { productId } })
  const method = product.costingMethod === 'fifo' || product.costingMethod === 'standard'
    ? product.costingMethod
    : 'average'

  if (method === 'fifo') {
    const batches = await tx.inventoryBatch.findMany({
      where: { productId, quantityAvailable: { gt: 0 } },
      orderBy: [{ receivedAt: 'asc' }, { createdAt: 'asc' }],
    })
    let remaining = qty
    let totalCost = 0
    for (const batch of batches) {
      if (remaining <= 0) break
      const take = Math.min(remaining, batch.quantityAvailable)
      if (take <= 0) continue
      const claimed = await tx.inventoryBatch.updateMany({
        where: { id: batch.id, quantityAvailable: batch.quantityAvailable },
        data: { quantityAvailable: { decrement: take } },
      })
      if (claimed.count !== 1) throw new Error('FIFO layer changed concurrently; retry transaction')
      totalCost += take * Number(batch.unitCost || 0)
      remaining -= take
    }
    if (remaining > 0) throw new Error(`Insufficient FIFO layers for product ${productId}: short ${remaining}`)
    const remainingBatches = await tx.inventoryBatch.findMany({
      where: { productId, quantityAvailable: { gt: 0 } },
      select: { quantityAvailable: true, unitCost: true },
    })
    const totalQty = remainingBatches.reduce((a,b)=>a+b.quantityAvailable,0)
    const totalValue = money(remainingBatches.reduce((a,b)=>a+b.quantityAvailable*Number(b.unitCost||0),0))
    const averageCost = totalQty > 0 ? totalValue / totalQty : 0
    await tx.productValuation.upsert({
      where: { productId },
      create: { productId, averageCost, totalQty, totalValue },
      update: { averageCost, totalQty, totalValue },
    })
    return { unitCost: money(totalCost / qty), totalCost: money(totalCost), totalQty, totalValue }
  }

  const unitCost = method === 'standard'
    ? Math.max(0, Number(product.costPrice || valuation?.averageCost || 0))
    : Math.max(0, Number(valuation?.averageCost || 0))
  if (!valuation || valuation.totalQty < qty) {
    throw new Error(`Insufficient valued stock for product ${productId}: need ${qty}, valued ${valuation?.totalQty ?? 0}`)
  }
  const totalCost = money(unitCost * qty)
  const totalQty = valuation.totalQty - qty
  const totalValue = money(Math.max(0, Number(valuation.totalValue) - totalCost))
  await tx.productValuation.update({
    where: { productId },
    data: { totalQty, totalValue, averageCost: totalQty > 0 ? money(totalValue / totalQty) : unitCost },
  })
  return { unitCost, totalCost, totalQty, totalValue }
}

async function addCost(tx: Prisma.TransactionClient, params: {
  productId: string
  qty: number
  receiptCost: number
  reference: string
  receivedAt: Date
  grnItemId?: string | null
  purchaseOrderId?: string | null
}) {
  const product = await tx.product.findUnique({
    where: { id: params.productId },
    select: { costingMethod: true, costPrice: true },
  })
  if (!product) throw new Error(`Product not found in relational inventory: ${params.productId}`)
  const method = product.costingMethod === 'fifo' || product.costingMethod === 'standard'
    ? product.costingMethod
    : 'average'
  const inventoryUnitCost = method === 'standard'
    ? Math.max(0, Number(product.costPrice || params.receiptCost))
    : Math.max(0, params.receiptCost)
  const valuation = await tx.productValuation.findUnique({ where: { productId: params.productId } })
  const priorQty = valuation?.totalQty ?? 0
  const priorValue = Number(valuation?.totalValue ?? 0)
  const newQty = priorQty + params.qty
  const newValue = money(priorValue + inventoryUnitCost * params.qty)
  const averageCost = newQty > 0 ? newValue / newQty : 0

  if (method === 'fifo') {
    await tx.inventoryBatch.create({
      data: {
        batchNumber: `RCV-${params.reference}-${params.productId.slice(0,8)}`.slice(0,100),
        productId: params.productId,
        warehouseId: 'main',
        quantityReceived: params.qty,
        quantityAvailable: params.qty,
        unitCost: inventoryUnitCost,
        receivedLineId: params.grnItemId ?? null,
        purchaseOrderId: params.purchaseOrderId ?? null,
        receivedAt: params.receivedAt,
      },
    })
  }
  await tx.productValuation.upsert({
    where: { productId: params.productId },
    create: { productId: params.productId, averageCost, totalQty: newQty, totalValue: newValue },
    update: { averageCost, totalQty: newQty, totalValue: newValue },
  })
  return {
    inventoryUnitCost,
    inventoryValue: money(inventoryUnitCost * params.qty),
    grniValue: money(params.receiptCost * params.qty),
    totalQty: newQty,
    totalValue: newValue,
  }
}

async function mutateStockLevel(tx: Prisma.TransactionClient, productId: string, delta: number, reservedDelta = 0) {
  const current = await tx.stockLevel.findUnique({ where: { productId } })
  const onHand = current?.qtyOnHand ?? 0
  const reserved = current?.qtyReserved ?? 0
  const next = onHand + delta
  if (next < 0) throw new Error(`Negative stock is prohibited for ${productId}: ${onHand} + (${delta})`)
  if (current) {
    const claimed = await tx.stockLevel.updateMany({
      where: { id: current.id, qtyOnHand: current.qtyOnHand, qtyReserved: current.qtyReserved },
      data: {
        qtyOnHand: { increment: delta },
        qtyReserved: { increment: reservedDelta },
      },
    })
    if (claimed.count !== 1) throw new Error('Stock level changed concurrently; retry transaction')
  } else {
    if (delta < 0) throw new Error(`No on-hand stock exists for ${productId}`)
    await tx.stockLevel.create({ data: { productId, qtyOnHand: delta, qtyReserved: Math.max(0,reservedDelta) } })
  }
}

export async function validateDeliveryAtomic(input: {
  deliveryId: string
  deliveryRef: string
  saleOrderId?: string | null
  documentDate: Date
  lines: Array<{ productId: string; qty: number; serialIds?: string[]; sourceLocation?: string }>
  actorId: string
}) {
  return prisma.$transaction(async tx => {
    const existing = await tx.deliveryNote.findFirst({
      where: { OR: [{ id: input.deliveryId }, { blobId: input.deliveryId }, { dnNumber: input.deliveryRef }] },
    })
    if (existing?.status === 'done') {
      const journal = await tx.journalEntry.findFirst({ where: { sourceType: 'stock_delivery', sourceId: existing.id } })
      return { deliveryId: existing.id, idempotent: true as const, journalId: journal?.id ?? null }
    }

    const costs: Array<{ productId:string; qty:number; unitCost:number; totalCost:number; location:string; serialIds:string[] }> = []
    for (const line of input.lines) {
      const qty = qtyInt(line.qty)
      if (!line.productId || qty <= 0) continue
      const eventKey = `delivery:${input.deliveryRef}:${line.productId}`
      const priorEvent = await tx.inventoryLedgerEntry.findUnique({ where: { eventKey } })
      if (priorEvent) throw new Error(`Inventory event already exists for ${eventKey}`)
      await mutateStockLevel(tx, line.productId, -qty)
      const cost = await consumeCost(tx, line.productId, qty)
      const serialIds = Array.isArray(line.serialIds) ? line.serialIds : []
      if (serialIds.length) {
        if (serialIds.length !== qty) throw new Error(`Exactly ${qty} serial(s) required for product ${line.productId}`)
        const changed = await tx.serialNumber.updateMany({
          where: { id: { in: serialIds }, productId: line.productId, status: { in: ['in_stock','available','assigned'] } },
          data: { status: 'sold' },
        })
        if (changed.count !== qty) throw new Error(`One or more serials for ${line.productId} are unavailable`)
      }
      costs.push({ productId: line.productId, qty, unitCost: cost.unitCost, totalCost: cost.totalCost, location: line.sourceLocation || 'warehouse', serialIds })
    }
    if (!costs.length) throw new Error('Delivery has no stock-tracked quantity to validate')
    const totalCost = money(costs.reduce((a,x)=>a+x.totalCost,0))
    const journal = await createJournalEntryInTx(tx, {
      ref: `JRN/STK/DEL/${input.deliveryRef}`.slice(0,80),
      journalCode: 'STK',
      date: input.documentDate,
      description: `Delivery COGS ${input.deliveryRef}`,
      sourceType: 'stock_delivery',
      sourceId: input.deliveryId,
      createdById: input.actorId,
      skipIfExists: false,
      lines: [
        { accountLabel: labelForRole('cogs'), label: `COGS ${input.deliveryRef}`, debit: totalCost, credit: 0 },
        { accountLabel: labelForRole('inventory'), label: `Inventory ${input.deliveryRef}`, debit: 0, credit: totalCost },
      ],
    })
    for (const row of costs) {
      const eventKey = `delivery:${input.deliveryRef}:${row.productId}`
      await tx.inventoryLedgerEntry.create({
        data: {
          eventKey, productId: row.productId, location: row.location, movementType: 'delivery',
          quantity: -row.qty, unitCost: row.unitCost, value: -row.totalCost,
          documentDate: input.documentDate, sourceType: 'delivery', sourceId: input.deliveryId,
          journalEntryId: journal.id,
        },
      })
      await tx.valuationEvent.create({
        data: { eventKey: `VAL/${eventKey}`.slice(0,120), kind: 'delivery', productId: row.productId, qty: row.qty, unitCost: row.unitCost, reference: input.deliveryRef.slice(0,80) },
      })
      await tx.stockMovement.create({
        data: {
          productId: row.productId, movementType: 'sale', qty: row.qty,
          qtyBefore: 0, qtyAfter: 0, unitCost: row.unitCost,
          referenceType: 'delivery', referenceId: /^[0-9a-f-]{36}$/i.test(input.deliveryId) ? input.deliveryId : null,
          documentRef: input.deliveryRef, fromLocation: row.location, toLocation: 'customer',
          serialNumbers: row.serialIds, createdById: input.actorId,
        },
      })
    }
    const delivery = existing
      ? await tx.deliveryNote.update({ where: { id: existing.id }, data: { status: 'done', deliveryDate: input.documentDate } })
      : null
    await writeFinancialAuditInTx(tx, {
      userId: input.actorId, action: 'validate_delivery', entityType: 'delivery',
      entityId: delivery?.id ?? input.deliveryId, relatedJournalId: journal.id,
      newValues: { status:'done', totalCost, lineCount: costs.length },
    })
    return { deliveryId: delivery?.id ?? input.deliveryId, idempotent:false as const, journalId:journal.id, totalCost }
  }, { isolationLevel:'Serializable' })
}

export async function validateGoodsReceiptAtomic(input: {
  receiptRef: string
  purchaseOrderId: string
  documentDate: Date
  supplierInvoiceNo?: string | null
  notes?: string | null
  actorId: string
  lines: Array<{ poItemId?: string; productId: string; qty: number; unitCost?: number; serialNumbers?: string[]; destination?: string }>
}) {
  return prisma.$transaction(async tx => {
    const prior = await tx.goodsReceivedNote.findUnique({ where: { grnNumber: input.receiptRef } })
    if (prior) {
      const journal = await tx.journalEntry.findFirst({ where: { sourceType:'stock_receipt', sourceId:prior.id } })
      return { grnId:prior.id, idempotent:true as const, journalId:journal?.id ?? null }
    }
    const po = await tx.purchaseOrder.findUnique({ where:{ id:input.purchaseOrderId }, include:{ items:true } })
    if (!po) throw new Error('Purchase order not found')
    const grn = await tx.goodsReceivedNote.create({
      data:{ grnNumber:input.receiptRef, poId:po.id, receivedDate:input.documentDate, supplierInvoiceNo:input.supplierInvoiceNo ?? null, notes:input.notes ?? null, createdById:input.actorId }
    })
    const valuations:any[]=[]
    for(const line of input.lines){
      const qty=qtyInt(line.qty); if(!line.productId || qty<=0) continue
      let poItem=line.poItemId ? po.items.find(x=>x.id===line.poItemId) : po.items.find(x=>x.productId===line.productId)
      if(!poItem) throw new Error(`Receipt line ${line.productId} is not linked to PO`)
      if(poItem.productId!==line.productId) throw new Error('Receipt product does not match PO line')
      if(poItem.qtyReceived + qty > poItem.qtyOrdered) throw new Error(`Receipt exceeds ordered quantity on PO line ${poItem.id}`)
      const receiptCost=money(line.unitCost ?? poItem.unitCost)
      const grnItem=await tx.grnItem.create({data:{grnId:grn.id,poItemId:poItem.id,productId:line.productId,qtyReceived:qty,unitCost:receiptCost,serialNumbers:line.serialNumbers ?? []}})
      await tx.purchaseOrderItem.update({where:{id:poItem.id},data:{qtyReceived:{increment:qty}}})
      await mutateStockLevel(tx,line.productId,qty)
      const val=await addCost(tx,{productId:line.productId,qty,receiptCost,reference:input.receiptRef,receivedAt:input.documentDate,grnItemId:grnItem.id,purchaseOrderId:po.id})
      if(Array.isArray(line.serialNumbers) && line.serialNumbers.length){
        if(line.serialNumbers.length!==qty) throw new Error(`Exactly ${qty} serial(s) required for ${line.productId}`)
        for(const serialNumber of line.serialNumbers){
          await tx.serialNumber.create({data:{productId:line.productId,serialNumber,status:'in_stock',purchaseItemId:grnItem.id}})
        }
      }
      valuations.push({productId:line.productId,qty,receiptCost,grnItemId:grnItem.id,...val,location:line.destination || 'warehouse'})
    }
    const inventoryDebit=money(valuations.reduce((a,x)=>a+x.inventoryValue,0))
    const grniCredit=money(valuations.reduce((a,x)=>a+x.grniValue,0))
    const variance=money(grniCredit-inventoryDebit)
    const journalLines:any[]=[{accountLabel:labelForRole('inventory'),label:`Inventory receipt ${input.receiptRef}`,debit:inventoryDebit,credit:0}]
    if(variance>0) journalLines.push({accountLabel:'6307 - Purchase Price Difference',label:'Purchase price variance',debit:variance,credit:0})
    else if(variance<0) journalLines.push({accountLabel:'6307 - Purchase Price Difference',label:'Purchase price variance',debit:0,credit:-variance})
    journalLines.push({accountLabel:labelForRole('grni'),label:`GRNI ${input.receiptRef}`,debit:0,credit:grniCredit})
    const journal=await createJournalEntryInTx(tx,{ref:`JRN/STK/RCV/${input.receiptRef}`.slice(0,80),journalCode:'STK',date:input.documentDate,description:`Goods receipt ${input.receiptRef}`,sourceType:'stock_receipt',sourceId:grn.id,createdById:input.actorId,skipIfExists:false,lines:journalLines})
    for(const row of valuations){
      const eventKey=`receipt:${input.receiptRef}:${row.productId}`
      await tx.inventoryLedgerEntry.create({data:{eventKey,productId:row.productId,location:row.location,movementType:'receipt',quantity:row.qty,unitCost:row.inventoryUnitCost,value:row.inventoryValue,documentDate:input.documentDate,sourceType:'receipt',sourceId:grn.id,journalEntryId:journal.id}})
      await tx.valuationEvent.create({data:{eventKey:`VAL/${eventKey}`.slice(0,120),kind:'receipt',productId:row.productId,qty:row.qty,unitCost:row.inventoryUnitCost,reference:input.receiptRef.slice(0,80)}})
    }
    await writeFinancialAuditInTx(tx,{userId:input.actorId,action:'validate_goods_receipt',entityType:'goods_received_note',entityId:grn.id,relatedJournalId:journal.id,newValues:{receiptRef:input.receiptRef,inventoryDebit,grniCredit,variance}})
    return {grnId:grn.id,idempotent:false as const,journalId:journal.id,inventoryDebit,grniCredit,variance}
  },{isolationLevel:'Serializable'})
}
