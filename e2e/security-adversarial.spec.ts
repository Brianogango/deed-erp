import { test, expect } from '@playwright/test'

import { E2E_USERS } from './global-setup'
import { loginAs } from './helpers'

function rows(body: any): any[] {
  if (Array.isArray(body)) return body
  if (Array.isArray(body?.items)) return body.items
  if (Array.isArray(body?.data)) return body.data
  return []
}

test.describe('security adversarial RBAC and IDOR', () => {
  test('sales users cannot horizontally read, edit, delete, or list another sales rep sale order', async ({ browser }) => {
    const owner = await loginAs(browser, E2E_USERS.salesA)
    const attacker = await loginAs(browser, E2E_USERS.salesB)

    const created = await owner.request.post('/api/sale-orders', {
      data: {
        customerName: 'IDOR Owner Customer',
        lines: [{ productName: 'Security Test Item', qty: 1, unitPrice: 1000, taxRate: 0, lineTotal: 1000 }],
      },
    })
    expect(created.status()).toBe(201)
    const order = await created.json()
    expect(order.id).toBeTruthy()

    const ownerRead = await owner.request.get(`/api/sale-orders/${order.id}`)
    expect(ownerRead.status()).toBe(200)

    const attackerRead = await attacker.request.get(`/api/sale-orders/${order.id}`)
    expect(attackerRead.status()).toBe(403)

    const attackerEdit = await attacker.request.patch(`/api/sale-orders/${order.id}`, {
      data: { notes: 'horizontal privilege escalation attempt' },
    })
    expect(attackerEdit.status()).toBe(403)

    const attackerDelete = await attacker.request.delete(`/api/sale-orders/${order.id}`)
    expect(attackerDelete.status()).toBe(403)

    const attackerList = await attacker.request.get('/api/sale-orders?limit=100')
    expect(attackerList.status()).toBe(200)
    const attackerBody = await attackerList.json()
    expect(rows(attackerBody).some((entry: any) => entry.id === order.id)).toBe(false)

    const ownerList = await owner.request.get('/api/sale-orders?limit=100')
    expect(ownerList.status()).toBe(200)
    const ownerBody = await ownerList.json()
    expect(rows(ownerBody).some((entry: any) => entry.id === order.id)).toBe(true)

    await owner.close()
    await attacker.close()
  })

  test('sales users cannot horizontally access another rep CRM opportunity', async ({ browser }) => {
    const owner = await loginAs(browser, E2E_USERS.salesA)
    const attacker = await loginAs(browser, E2E_USERS.salesB)

    const contact = await owner.request.post('/api/contacts', {
      data: {
        name: `IDOR CRM Customer ${Date.now()}`,
        type: 'company',
        isCustomer: true,
        isVendor: false,
        phone: `07${String(Date.now()).slice(-8)}`,
      },
    })
    expect([200, 201]).toContain(contact.status())
    const contactBody = await contact.json()
    expect(contactBody.id).toBeTruthy()

    const created = await owner.request.post('/api/opportunities', {
      data: {
        clientId: contactBody.id,
        name: `Owner Opportunity ${Date.now()}`,
        stage: 'new',
        probability: 20,
        value: 10000,
      },
    })
    expect(created.status()).toBe(201)
    const opportunity = await created.json()

    expect((await owner.request.get(`/api/opportunities/${opportunity.id}`)).status()).toBe(200)
    expect((await attacker.request.get(`/api/opportunities/${opportunity.id}`)).status()).toBe(403)
    expect((await attacker.request.patch(`/api/opportunities/${opportunity.id}`, {
      data: { value: 99999999 },
    })).status()).toBe(403)
    expect((await attacker.request.delete(`/api/opportunities/${opportunity.id}`)).status()).toBe(403)

    const attackerList = await attacker.request.get('/api/opportunities')
    expect(attackerList.status()).toBe(200)
    const attackerRows = await attackerList.json()
    expect(Array.isArray(attackerRows) && attackerRows.some((entry: any) => entry.id === opportunity.id)).toBe(false)

    await owner.close()
    await attacker.close()
  })

  test('technician cannot create commercial sale orders', async ({ browser }) => {
    const technician = await loginAs(browser, E2E_USERS.technician)
    const response = await technician.request.post('/api/sale-orders', {
      data: {
        customerName: 'Unauthorized Commercial Customer',
        notes: 'repair — client-controlled text must not grant sales authority',
        lines: [{ productName: 'Unauthorized Item', qty: 1, unitPrice: 5000, taxRate: 0 }],
      },
    })
    expect(response.status()).toBe(403)
    await technician.close()
  })

  test('sales user cannot self-promote or modify another user', async ({ browser }) => {
    const sales = await loginAs(browser, E2E_USERS.salesA)

    const selfPromote = await sales.request.patch(`/api/users/${E2E_USERS.salesA.id}`, {
      data: {
        role: 'director',
        modules: ['accounting', 'hr', 'inventory'],
      },
    })
    expect(selfPromote.status()).toBe(200)
    const selfBody = await selfPromote.json()
    expect(selfBody.user.role).toBe('sales_rep')
    expect(selfBody.user.modules).not.toEqual(['accounting', 'hr', 'inventory'])

    const otherUser = await sales.request.patch(`/api/users/${E2E_USERS.salesB.id}`, {
      data: { name: 'Compromised User' },
    })
    expect(otherUser.status()).toBe(403)

    const privilegedAfterAttempt = await sales.request.post('/api/admin/reset', {
      data: { confirmation: 'RESET DEED ERP PRODUCTION DATA' },
    })
    expect(privilegedAfterAttempt.status()).toBe(403)

    await sales.close()
  })

  test('finance and operational roles remain outside Director-only and journal-posting boundaries', async ({ browser }) => {
    const finance = await loginAs(browser, E2E_USERS.finance)
    const inventory = await loginAs(browser, E2E_USERS.inventory)
    const sales = await loginAs(browser, E2E_USERS.salesA)

    expect((await finance.request.post('/api/admin/reset', { data: {} })).status()).toBe(403)
    expect((await inventory.request.get('/api/users')).status()).toBe(403)
    expect((await sales.request.get('/api/accounting/journals')).status()).toBe(403)

    const journalAttempt = await sales.request.post('/api/accounting/journals', {
      data: {
        ref: 'ATTACK-JRN',
        description: 'Unauthorized journal',
        lines: [
          { account: 'Cash', debit: 100, credit: 0 },
          { account: 'Sales', debit: 0, credit: 100 },
        ],
      },
    })
    expect(journalAttempt.status()).toBe(403)

    await finance.close()
    await inventory.close()
    await sales.close()
  })

  test('cross-origin authenticated writes and unknown store namespaces fail closed', async ({ browser }) => {
    const sales = await loginAs(browser, E2E_USERS.salesA)

    const crossOrigin = await sales.request.put('/api/store/deed_contacts', {
      headers: { Origin: 'https://evil.example' },
      data: { value: [] },
    })
    expect(crossOrigin.status()).toBe(403)

    const unknown = await sales.request.post('/api/store', {
      data: { deed_attackerControlled: [] },
    })
    expect([400, 403]).toContain(unknown.status())

    await sales.close()
  })

  test('password rotation invalidates the already-issued session', async ({ browser }) => {
    const identity = E2E_USERS.sessionProbe
    const context = await loginAs(browser, identity)
    const nextPassword = `Session-Probe-${Date.now()}-Aa1!`

    const changed = await context.request.patch(`/api/users/${identity.id}`, {
      data: { password: nextPassword },
    })
    expect(changed.status()).toBe(200)

    const staleSession = await context.request.get('/api/store')
    expect(staleSession.status()).toBe(401)
    await context.close()

    const fresh = await browser.newContext()
    const relogin = await fresh.request.post('/api/auth/login', {
      data: { username: identity.username, password: nextPassword },
    })
    expect(relogin.status()).toBe(200)
    await fresh.close()
  })

  test('malformed authentication and disabled bootstrap fail closed', async ({ request }) => {
    const malformed = await request.get('/api/store', {
      headers: { Authorization: 'Bearer %E0%A4%A' },
    })
    expect(malformed.status()).toBe(401)

    const setup = await request.post('/api/setup-admin', {
      data: { password: 'Strong-Bootstrap-Password-2026!' },
    })
    expect([401, 503]).toContain(setup.status())
  })
})
