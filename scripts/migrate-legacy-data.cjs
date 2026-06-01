const { PrismaClient } = require('@prisma/client')
const sqlite3 = require('sqlite3')
const { promisify } = require('util')
const path = require('path')

const prisma = new PrismaClient()
const dbPath = path.join(process.cwd(), 'data', 'store.db')
const db = new sqlite3.Database(dbPath)
const dbGet = promisify(db.get).bind(db)
const dbAll = promisify(db.all).bind(db)

async function migrate() {
  console.log('Starting migration from legacy SQLite store to Prisma...')

  try {
    const systemUser = await prisma.user.findFirst();
    const systemUserId = systemUser?.id || "00000000-0000-0000-0000-000000000000";

    // 1. Migrate Companies/Clients
    const companyData = await dbGet('SELECT value FROM store WHERE key = ?', ['deed_companies'])
    if (companyData) {
      const companies = JSON.parse(companyData.value)
      console.log(`Found ${companies.length} companies to migrate.`)
      for (const comp of companies) {
        await prisma.client.upsert({
          where: { id: comp.id },
          update: {
            name: comp.name,
            kraPin: comp.taxId ?? comp.kraPin ?? null,
            email: comp.email ?? null,
            phone: comp.phone ?? null,
            addressLine1: comp.physicalAddress ?? comp.address ?? null,
            city: comp.city ?? null,
            country: comp.country || 'Kenya',
            isActive: comp.status ? comp.status !== 'inactive' : true,
            creditLimit: Number(comp.creditLimit ?? 0),
            segment: comp.segment ?? null,
            industry: comp.industry ?? null,
          },
          create: {
            id: comp.id,
            clientNumber: `CLT-${String(comp.id).slice(-8)}`,
            clientType: 'company',
            name: comp.name,
            kraPin: comp.taxId ?? comp.kraPin ?? null,
            email: comp.email ?? null,
            phone: comp.phone ?? null,
            addressLine1: comp.physicalAddress ?? comp.address ?? null,
            city: comp.city ?? null,
            country: comp.country || 'Kenya',
            isActive: comp.status ? comp.status !== 'inactive' : true,
            creditLimit: Number(comp.creditLimit ?? 0),
            segment: comp.segment ?? null,
            industry: comp.industry ?? null,
          }
        })
      }
    }

    // 2. Migrate Contact Persons
    const contactData = await dbGet('SELECT value FROM store WHERE key = ?', ['deed_contactPersons'])
    if (contactData) {
      const contacts = JSON.parse(contactData.value)
      console.log(`Found ${contacts.length} contacts to migrate.`)
      for (const c of contacts) {
        await prisma.contactPerson.upsert({
          where: { id: c.id },
          update: {
            clientId: c.clientId ?? c.companyId,
            firstName: c.firstName,
            lastName: c.lastName,
            position: c.jobTitle ?? c.position ?? null,
            email: c.email ?? null,
            phone: c.phone ?? null,
            notes: c.notes ?? null,
          },
          create: {
            id: c.id,
            clientId: c.clientId ?? c.companyId,
            firstName: c.firstName,
            lastName: c.lastName,
            position: c.jobTitle ?? c.position ?? null,
            email: c.email ?? null,
            phone: c.phone ?? null,
            notes: c.notes ?? null,
          }
        })
      }
    }

    // 3. Migrate Opportunities
    const oppData = await dbGet('SELECT value FROM store WHERE key = ?', ['deed_opportunities'])
    if (oppData) {
      const opps = JSON.parse(oppData.value)
      console.log(`Found ${opps.length} opportunities to migrate.`)
      for (const o of opps) {
        await prisma.opportunity.upsert({
          where: { id: o.id },
          update: {
            name: o.name,
            clientId: o.clientId ?? o.companyId,
            assignedToId: o.assignedToId ?? o.ownerId ?? null,
            stage: o.stage ?? 'new',
            probability: Number(o.probability ?? 0),
            value: Number(o.expectedValue ?? o.value ?? 0),
            closeDate: o.expectedCloseDate ? new Date(o.expectedCloseDate)
                       : o.closeDate ? new Date(o.closeDate) : null,
            description: o.description ?? null,
          },
          create: {
            id: o.id,
            name: o.name,
            clientId: o.clientId ?? o.companyId,
            createdById: systemUserId,
            assignedToId: o.assignedToId ?? o.ownerId ?? null,
            stage: o.stage ?? 'new',
            probability: Number(o.probability ?? 0),
            value: Number(o.expectedValue ?? o.value ?? 0),
            closeDate: o.expectedCloseDate ? new Date(o.expectedCloseDate)
                       : o.closeDate ? new Date(o.closeDate) : null,
            description: o.description ?? null,
          }
        })
      }
    }

    // 4. Migrate Sale Orders
    const orderData = await dbGet('SELECT value FROM store WHERE key = ?', ['deed_saleOrders'])
    if (orderData) {
      const orders = JSON.parse(orderData.value)
      console.log(`Found ${orders.length} sale orders to migrate.`)
      for (const o of orders) {
        await prisma.saleOrder.upsert({
          where: { id: o.id },
          update: {
            orderNumber: o.orderNumber ?? o.ref,
            clientId: o.clientId ?? o.customerId,
            orderDate: new Date(o.orderDate ?? o.date ?? Date.now()),
            status: o.status ?? 'pending',
            totalAmount: Number(o.totalAmount ?? o.total ?? 0),
            taxAmount: Number(o.taxAmount ?? o.taxTotal ?? 0),
            subtotal: Number(o.subtotal ?? 0),
            notes: o.notes ?? null,
            quoteId: o.quoteId ?? null,
          },
          create: {
            id: o.id,
            orderNumber: o.orderNumber ?? o.ref ?? `SO-MIG-${o.id.slice(-6)}`,
            clientId: o.clientId ?? o.customerId,
            orderDate: new Date(o.orderDate ?? o.date ?? Date.now()),
            status: o.status ?? 'pending',
            totalAmount: Number(o.totalAmount ?? o.total ?? 0),
            taxAmount: Number(o.taxAmount ?? o.taxTotal ?? 0),
            subtotal: Number(o.subtotal ?? 0),
            notes: o.notes ?? null,
            quoteId: o.quoteId ?? null,
            createdById: systemUserId,
          }
        })

        if (o.items && Array.isArray(o.items)) {
          for (const item of o.items) {
            await prisma.saleOrderItem.create({
              data: {
                saleOrderId: o.id,
                productId: item.productId || undefined,
                description: item.description ?? item.productName ?? null,
                qty: Number(item.quantity ?? item.qty ?? 1),
                unitPrice: Number(item.unitPrice ?? 0),
                lineTotal: Number(item.total ?? item.lineTotal ?? item.subtotal ?? 0),
              }
            })
          }
        }
      }
    }

    console.log('Migration completed successfully!')
  } catch (error) {
    console.error('Migration failed:', error)
  } finally {
    await prisma.$disconnect()
    db.close()
  }
}

migrate()
