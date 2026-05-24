import { PrismaClient } from '@prisma/client'
import sqlite3 from 'sqlite3'
import { promisify } from 'util'
import path from 'path'

const prisma = new PrismaClient()
const dbPath = path.join(process.cwd(), 'data', 'store.db')
const db = new sqlite3.Database(dbPath)
const dbGet = promisify(db.get).bind(db)
const dbAll = promisify(db.all).bind(db)

async function migrate() {
  console.log('Starting migration from legacy SQLite store to Prisma...')

  try {
    // 1. Migrate Companies/Clients
    const companyData = await dbGet('SELECT value FROM store WHERE key = ?', ['deed_companies'])
    if (companyData) {
      const companies = JSON.parse((companyData as any).value)
      console.log(`Found ${companies.length} companies to migrate.`)
      for (const comp of companies) {
        await prisma.client.upsert({
          where: { id: comp.id },
          update: {
            name: comp.name,
            taxId: comp.taxId,
            email: comp.email,
            phone: comp.phone,
            website: comp.website,
            physicalAddress: comp.physicalAddress,
            city: comp.city,
            country: comp.country || 'Kenya',
            status: comp.status || 'active',
            paymentTerms: comp.paymentTerms || 30,
            creditLimit: comp.creditLimit || 0,
            creditUsed: comp.creditUsed || 0,
            segment: comp.segment || 'sme',
            industry: comp.industry || '',
          },
          create: {
            id: comp.id,
            name: comp.name,
            taxId: comp.taxId,
            email: comp.email,
            phone: comp.phone,
            website: comp.website,
            physicalAddress: comp.physicalAddress,
            city: comp.city,
            country: comp.country || 'Kenya',
            status: comp.status || 'active',
            paymentTerms: comp.paymentTerms || 30,
            creditLimit: comp.creditLimit || 0,
            creditUsed: comp.creditUsed || 0,
            segment: comp.segment || 'sme',
            industry: comp.industry || '',
          }
        })
      }
    }

    // 2. Migrate Contact Persons
    const contactData = await dbGet('SELECT value FROM store WHERE key = ?', ['deed_contactPersons'])
    if (contactData) {
      const contacts = JSON.parse((contactData as any).value)
      console.log(`Found ${contacts.length} contacts to migrate.`)
      for (const c of contacts) {
        await prisma.contactPerson.upsert({
          where: { id: c.id },
          update: {
            clientId: c.companyId,
            firstName: c.firstName,
            lastName: c.lastName,
            jobTitle: c.jobTitle,
            email: c.email,
            phone: c.phone,
            mobile: c.mobile,
            isPrimary: c.isPrimary || false,
            isDecisionMaker: c.isDecisionMaker || false,
            preferredChannel: c.preferredChannel || 'email',
            notes: c.notes || '',
          },
          create: {
            id: c.id,
            clientId: c.companyId,
            firstName: c.firstName,
            lastName: c.lastName,
            jobTitle: c.jobTitle,
            email: c.email,
            phone: c.phone,
            mobile: c.mobile,
            isPrimary: c.isPrimary || false,
            isDecisionMaker: c.isDecisionMaker || false,
            preferredChannel: c.preferredChannel || 'email',
            notes: c.notes || '',
          }
        })
      }
    }

    // 3. Migrate Opportunities
    const oppData = await dbGet('SELECT value FROM store WHERE key = ?', ['deed_opportunities'])
    if (oppData) {
      const opps = JSON.parse((oppData as any).value)
      console.log(`Found ${opps.length} opportunities to migrate.`)
      for (const o of opps) {
        await prisma.opportunity.upsert({
          where: { id: o.id },
          update: {
            name: o.name,
            ref: o.ref,
            clientId: o.companyId,
            contactPersonId: o.contactPersonId,
            assignedToId: o.assignedToId,
            stage: o.stage,
            status: o.status,
            probability: o.probability,
            expectedValue: o.expectedValue,
            actualValue: o.actualValue,
            expectedCloseDate: o.expectedCloseDate ? new Date(o.expectedCloseDate) : null,
            actualCloseDate: o.actualCloseDate ? new Date(o.actualCloseDate) : null,
            leadSource: o.leadSource,
            description: o.description,
            lossReason: o.lossReason,
            lostToCompetitor: o.lostToCompetitor,
          },
          create: {
            id: o.id,
            name: o.name,
            ref: o.ref,
            clientId: o.companyId,
            contactPersonId: o.contactPersonId,
            assignedToId: o.assignedToId,
            stage: o.stage,
            status: o.status,
            probability: o.probability,
            expectedValue: o.expectedValue,
            actualValue: o.actualValue,
            expectedCloseDate: o.expectedCloseDate ? new Date(o.expectedCloseDate) : null,
            actualCloseDate: o.actualCloseDate ? new Date(o.actualCloseDate) : null,
            leadSource: o.leadSource,
            description: o.description,
            lossReason: o.lossReason,
            lostToCompetitor: o.lostToCompetitor,
          }
        })
      }
    }

    // 4. Migrate Sale Orders
    const orderData = await dbGet('SELECT value FROM store WHERE key = ?', ['deed_saleOrders'])
    if (orderData) {
      const orders = JSON.parse((orderData as any).value)
      console.log(`Found ${orders.length} sale orders to migrate.`)
      for (const o of orders) {
        await prisma.saleOrder.upsert({
          where: { id: o.id },
          update: {
            ref: o.ref,
            customerId: o.customerId,
            date: new Date(o.date),
            status: o.status,
            total: o.total,
            notes: o.notes,
            quoteId: o.quoteId,
          },
          create: {
            id: o.id,
            ref: o.ref,
            customerId: o.customerId,
            date: new Date(o.date),
            status: o.status,
            total: o.total,
            notes: o.notes,
            quoteId: o.quoteId,
          }
        })
        
        // Migrate items if they exist
        if (o.items && Array.isArray(o.items)) {
          for (const item of o.items) {
            await prisma.saleOrderItem.create({
              data: {
                saleOrderId: o.id,
                productId: item.productId,
                description: item.description,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                total: item.total,
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
