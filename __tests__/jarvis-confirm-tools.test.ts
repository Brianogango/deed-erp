/**
 * DIA confirm-before-save tools (contacts, products, purchase orders), the
 * signed confirmation cards, reports scoped to the caller, and attachments.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockPrisma, mockContacts, mockPublishProduct, mockGetNextDocNumber, audit } = vi.hoisted(() => {
  const audit: any[] = []
  const mockPrisma: any = {
    client: { findFirst: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    product: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
    category: { findMany: vi.fn() },
    purchaseOrder: { create: vi.fn(), findMany: vi.fn() },
    saleOrder: { findMany: vi.fn() },
    invoice: { findMany: vi.fn() },
    aiAuditLog: {
      findFirst: vi.fn(async ({ where }: any) => audit.find(r => r.toolName === where.toolName && r.resultMeta?.nonce === where.resultMeta.equals) ?? null),
      create: vi.fn(async ({ data }: any) => { audit.push(data); return data }),
      deleteMany: vi.fn(async ({ where }: any) => { for (let i = audit.length - 1; i >= 0; i--) if (audit[i].resultMeta?.nonce === where.resultMeta.equals) audit.splice(i, 1) }),
    },
    $executeRawUnsafe: vi.fn(async () => 0),
  }
  mockPrisma.$transaction = vi.fn(async (fn: any) => fn(mockPrisma))
  return {
    mockPrisma,
    audit,
    mockContacts: { findExistingContact: vi.fn(), upsertContact: vi.fn() },
    mockPublishProduct: vi.fn(),
    mockGetNextDocNumber: vi.fn(async () => 'PO/2026/0101'),
  }
})

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ default: mockPrisma }))
vi.mock('@/lib/doc-ref-counter', () => ({ getNextDocNumber: mockGetNextDocNumber }))
vi.mock('@/lib/contact-prisma', () => ({
  findExistingContact: mockContacts.findExistingContact,
  upsertContact: mockContacts.upsertContact,
  withoutCreditTerms: (b: any) => b,
}))
vi.mock('@/lib/product-catalog-write', () => ({ publishProduct: mockPublishProduct }))
vi.mock('@/lib/purchase/po-prisma-sync', () => ({ resolvePOLineProducts: async (items: any[]) => items }))
vi.mock('@/lib/purchase/po-api-shared', async () => {
  const real: any = await vi.importActual('@/lib/purchase/po-api-shared')
  return { ...real, publishPurchaseOrder: vi.fn(async (po: any) => po) }
})

import { createContactTool } from '@/lib/jarvis/tools/create-contact'
import { createProductTool } from '@/lib/jarvis/tools/create-product'
import { createPurchaseOrderTool } from '@/lib/jarvis/tools/create-purchase-order'
import { runReportTool } from '@/lib/jarvis/tools/run-report'
import { signPendingAction, verifyPendingAction, claimPendingAction, releasePendingAction, PENDING_ACTION_TTL_MS } from '@/lib/jarvis/pending-actions'
import { isToolAllowedForRole } from '@/lib/jarvis/permissions'
import { extractDiaActions } from '@/lib/jarvis/actions'
import { parseDiaAttachments } from '@/lib/jarvis/attachments'
import { anthropicEffort } from '@/lib/jarvis/provider/anthropic'

const user = (role: string, extra: Record<string, unknown> = {}) => ({ id: `u-${role}`, name: role, username: role, role, modules: ['sales', 'purchase', 'inventory', 'contacts', 'crm', 'jarvis', 'accounting'], ...extra }) as any
const ctx = (role = 'director') => ({ user: user(role), conversationId: null, ipAddress: null }) as any

beforeEach(() => {
  vi.clearAllMocks()
  audit.length = 0
  mockPrisma.client.findMany.mockResolvedValue([])
  mockPrisma.category.findMany.mockResolvedValue([{ name: 'Laptops' }, { name: 'Accessories' }])
})

describe('confirmation cards', () => {
  it('only the signed-in owner can use a card, before it expires, untampered', () => {
    const token = signPendingAction({ tool: 'create_contact', input: { a: 1 }, userId: 'u-1', conversationId: null }, 1_000)
    expect(verifyPendingAction(token, 'u-1', 2_000)).toMatchObject({ ok: true })
    expect(verifyPendingAction(token, 'u-2', 2_000)).toMatchObject({ ok: false })
    expect(verifyPendingAction(token, 'u-1', 1_000 + PENDING_ACTION_TTL_MS + 1)).toMatchObject({ ok: false })
    const [body, sig] = token.split('.')
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), input: { a: 2 } })).toString('base64url')
    expect(verifyPendingAction(`${forged}.${sig}`, 'u-1', 2_000)).toMatchObject({ ok: false })
  })

  it('a card is confirmed once; a failed save frees it again', async () => {
    const token = signPendingAction({ tool: 'create_contact', input: {}, userId: 'u-1', conversationId: null })
    const v = verifyPendingAction(token, 'u-1')
    if (!v.ok) throw new Error('bad token')
    expect(await claimPendingAction(v.action)).toBe(true)
    expect(await claimPendingAction(v.action)).toBe(false)
    await releasePendingAction(v.action)
    expect(await claimPendingAction(v.action)).toBe(true)
  })

  it('previews become cards carrying the token; reports become tables', () => {
    const actions = extractDiaActions([
      { toolName: 'create_contact', input: {}, allowed: true, confirmToken: 'tok', output: { ok: true, needsConfirmation: true, title: 'New vendor · X', lines: [{ label: 'Name', value: 'X' }], input: {}, message: '' } },
      { toolName: 'create_contact', input: {}, allowed: true, output: { ok: false, message: 'exists' } },
      { toolName: 'run_report', input: {}, allowed: true, output: { ok: true, title: 'Sales', columns: ['A'], rows: [{ A: 1 }], totals: { A: 1 }, rowCount: 1, filters: {} } },
    ])
    expect(actions.map(a => a.type)).toEqual(['confirm_action', 'report'])
    expect(actions[0]).toMatchObject({ token: 'tok', title: 'New vendor · X' })
  })
})

describe('create_contact', () => {
  it('refuses an existing contact instead of creating a duplicate', async () => {
    mockContacts.findExistingContact.mockResolvedValue({ id: 'c-1', name: 'Acme Ltd', clientNumber: 'C-0001' })
    const out = await createContactTool.run(ctx(), { type: 'company', name: 'Acme Ltd', isVendor: true }) as any
    expect(out.ok).toBe(false)
    expect(out.message).toMatch(/already exists/)
  })

  it('previews, then saves only on confirm, and never overwrites a contact created meanwhile', async () => {
    mockContacts.findExistingContact.mockResolvedValue(null)
    mockPrisma.client.findMany.mockResolvedValue([{ name: 'Acme Holdings', clientNumber: 'C-0009' }])
    const preview = await createContactTool.run(ctx(), { type: 'company', name: 'Acme Ltd', isVendor: true, kraPin: 'a012345678b' }) as any
    expect(preview).toMatchObject({ ok: true, needsConfirmation: true })
    expect(preview.warnings.join(' ')).toMatch(/Acme Holdings/)
    expect(preview.warnings.join(' ')).toMatch(/KRA PIN/) // A… PIN on a company
    expect(mockContacts.upsertContact).not.toHaveBeenCalled()

    mockContacts.upsertContact.mockResolvedValue({ contact: { id: 'c-2', name: 'Acme Ltd' }, created: true })
    mockPrisma.client.findUnique.mockResolvedValue({ clientNumber: 'C-0010' })
    const saved = await createContactTool.confirm!.execute(ctx(), preview.input)
    expect(saved).toMatchObject({ ok: true, ref: 'C-0010' })
    expect(mockContacts.upsertContact.mock.calls[0][1]).toMatchObject({ name: 'Acme Ltd', isVendor: true, isCustomer: false, vatNumber: 'A012345678B' })

    mockContacts.findExistingContact.mockResolvedValue({ id: 'c-2', name: 'Acme Ltd', clientNumber: 'C-0010' })
    mockContacts.upsertContact.mockClear()
    expect(await createContactTool.confirm!.execute(ctx(), preview.input)).toMatchObject({ ok: false })
    expect(mockContacts.upsertContact).not.toHaveBeenCalled()
  })
})

describe('create_product', () => {
  it('refuses a duplicate name and warns on a new category', async () => {
    mockPrisma.product.findFirst.mockResolvedValueOnce({ name: 'HP 840 G6', sku: 'HP-840' })
    expect(await createProductTool.run(ctx('inventory_officer'), { name: 'HP 840 G6', category: 'Laptops', salePrice: 30000 })).toMatchObject({ ok: false })

    mockPrisma.product.findFirst.mockResolvedValueOnce(null)
    const preview = await createProductTool.run(ctx('inventory_officer'), { name: 'Dell 5490', category: 'Notebooks', salePrice: 28000, costPrice: 30000 }) as any
    expect(preview.needsConfirmation).toBe(true)
    expect(preview.warnings.join(' ')).toMatch(/new category/)
    expect(preview.warnings.join(' ')).toMatch(/cost is higher/)
    mockPublishProduct.mockResolvedValue({ status: 'created', product: { id: 'p-9', name: 'Dell 5490', sku: 'DELL-5490' } })
    expect(await createProductTool.confirm!.execute(ctx('inventory_officer'), preview.input)).toMatchObject({ ok: true, ref: 'DELL-5490' })
  })
})

describe('create_purchase_order', () => {
  const vendor = { id: '11111111-1111-4111-8111-111111111111', name: 'Laptop Hub', companyName: null, clientNumber: 'V-1', isVendor: true }
  const product = { id: '22222222-2222-4222-8222-222222222222', name: 'HP 840 G6', costPrice: 25000, latestCost: 26000 }

  it('asks which vendor when several match', async () => {
    mockPrisma.client.findMany.mockResolvedValueOnce([vendor, { ...vendor, id: '33333333-3333-4333-8333-333333333333', name: 'Laptop Hub Mombasa' }])
    const out = await createPurchaseOrderTool.run(ctx(), { vendor: 'Laptop', lines: [{ product: 'HP', qty: 1 }] }) as any
    expect(out.ok).toBe(false)
    expect(out.candidates).toHaveLength(2)
  })

  it('previews with the latest cost and saves a draft on confirm', async () => {
    mockPrisma.client.findMany.mockResolvedValueOnce([vendor])
    mockPrisma.product.findFirst.mockResolvedValueOnce(product)
    const preview = await createPurchaseOrderTool.run(ctx('inventory_officer'), { vendor: 'Laptop Hub', lines: [{ product: 'HP 840 G6', qty: 3, taxRate: 16 }], supplierRef: 'INV-77' }) as any
    expect(preview.needsConfirmation).toBe(true)
    expect(preview.input.lines[0]).toMatchObject({ productId: product.id, qty: 3, unitPrice: 26000, taxRate: 16 })
    expect(preview.lines.find((l: any) => l.label === 'Total').value).toMatch(/90,480/)
    expect(mockPrisma.purchaseOrder.create).not.toHaveBeenCalled()

    mockPrisma.client.findUnique.mockResolvedValue(vendor)
    mockPrisma.purchaseOrder.create.mockImplementation(async ({ data }: any) => ({ id: 'po-1', ...data }))
    const saved = await createPurchaseOrderTool.confirm!.execute(ctx('inventory_officer'), preview.input)
    expect(saved).toMatchObject({ ok: true, ref: 'PO/2026/0101' })
    const data = mockPrisma.purchaseOrder.create.mock.calls[0][0].data
    expect(data).toMatchObject({ status: 'draft', clientId: vendor.id, createdById: 'u-inventory_officer', totalAmount: 90480 })
    expect(data.notes).toMatch(/INV-77/)
  })

  it('stops when a product is not in the catalog', async () => {
    mockPrisma.client.findMany.mockResolvedValueOnce([vendor])
    mockPrisma.product.findFirst.mockResolvedValue(null)
    const out = await createPurchaseOrderTool.run(ctx(), { vendor: 'Laptop Hub', lines: [{ product: 'Unknown thing', qty: 1 }] }) as any
    expect(out.ok).toBe(false)
    expect(out.message).toMatch(/Not in the catalog/)
  })
})

describe('run_report', () => {
  it('sales reps get their own orders, without cost or margin', async () => {
    mockPrisma.saleOrder.findMany.mockResolvedValue([
      { totalAmount: 1160, subtotal: 1000, salespersonName: 'Rep', orderDate: new Date('2026-11-02'), client: { name: 'A', companyName: null }, items: [{ qty: 1, lineTotal: 1000, product: { name: 'X', costPrice: 700, latestCost: null } }] },
    ])
    const out = await runReportTool.run(ctx('sales_rep'), { report: 'sales', fromDate: '2026-11-01', toDate: '2026-11-05' }) as any
    const where = mockPrisma.saleOrder.findMany.mock.calls[0][0].where
    expect(where.OR).toEqual([{ createdById: 'u-sales_rep' }, { salespersonId: 'u-sales_rep' }])
    expect(where.status.notIn).toContain('quotation')
    expect(out.columns).not.toContain('Margin (KES)')
    expect(out.totals['Sales (KES)']).toBe(1160)
  })

  it('directors see margin', async () => {
    mockPrisma.saleOrder.findMany.mockResolvedValue([
      { totalAmount: 1160, subtotal: 1000, salespersonName: null, orderDate: new Date('2026-11-02'), client: { name: 'A', companyName: null }, items: [{ qty: 1, lineTotal: 1000, product: { name: 'X', costPrice: 700, latestCost: null } }] },
    ])
    const out = await runReportTool.run(ctx('director'), { report: 'sales' }) as any
    expect(out.totals['Margin (KES)']).toBe(300)
  })

  it('money reports need finance access', async () => {
    expect(await runReportTool.run(ctx('sales_rep'), { report: 'receivables' })).toMatchObject({ ok: false })
    expect(await runReportTool.run(ctx('inventory_officer'), { report: 'payables' })).toMatchObject({ ok: false })
    expect(mockPrisma.invoice.findMany).not.toHaveBeenCalled()
  })

  it('ages open invoices by due date', async () => {
    const today = new Date()
    const days = (d: number) => new Date(today.getTime() - d * 86_400_000)
    mockPrisma.invoice.findMany.mockResolvedValue([
      { totalAmount: 1000, amountPaid: 0, dueDate: days(45), invoiceDate: days(60), client: { name: 'A', companyName: null } },
      { totalAmount: 500, amountPaid: 500, dueDate: days(5), invoiceDate: days(10), client: { name: 'B', companyName: null } },
    ])
    const out = await runReportTool.run(ctx('finance_officer'), { report: 'receivables' }) as any
    expect(out.rows).toHaveLength(1)
    expect(out.rows[0]['31–60 days']).toBe(1000)
    expect(out.totals['Balance (KES)']).toBe(1000)
  })
})

describe('who gets which tool', () => {
  it('only the Director and inventory staff add products; technicians create nothing', () => {
    for (const role of ['director', 'inventory_officer']) expect(isToolAllowedForRole('create_product', role as any), role).toBe(true)
    for (const role of ['admin_officer', 'finance_officer', 'sales_rep', 'technical_lead', 'kilimall_officer', 'technician']) expect(isToolAllowedForRole('create_product', role as any), role).toBe(false)
    for (const tool of ['create_contact', 'create_product', 'create_purchase_order', 'run_report']) expect(isToolAllowedForRole(tool, 'technician')).toBe(false)
    expect(isToolAllowedForRole('create_purchase_order', 'sales_rep')).toBe(false)
    expect(isToolAllowedForRole('create_contact', 'sales_rep')).toBe(true)
  })
})

describe('attachments', () => {
  it('accepts photos and PDFs, refuses other files and oversize', () => {
    expect(parseDiaAttachments([{ name: 'inv.pdf', mediaType: 'application/pdf', data: 'JVBERi0x' }])).toMatchObject({ ok: true })
    expect(parseDiaAttachments([{ name: 'x.exe', mediaType: 'application/octet-stream', data: 'AAAA' }])).toMatchObject({ ok: false })
    expect(parseDiaAttachments([{ name: 'big.jpg', mediaType: 'image/jpeg', data: 'A'.repeat(10_000_004) }])).toMatchObject({ ok: false })
    expect(parseDiaAttachments(Array(5).fill({ name: 'a.png', mediaType: 'image/png', data: 'AAAA' }))).toMatchObject({ ok: false })
    const ok = parseDiaAttachments([{ name: 'a\n[b].png', mediaType: 'image/png', data: 'data:image/png;base64,AAAA' }]) as any
    expect(ok.attachments[0]).toMatchObject({ data: 'AAAA', name: 'a  b .png' })
  })
})

describe('effort', () => {
  it('defaults to low on current models, honours ANTHROPIC_EFFORT, skips old models', () => {
    expect(anthropicEffort('claude-opus-5-5', {} as any)).toBe('low')
    expect(anthropicEffort('claude-opus-5-5', { ANTHROPIC_EFFORT: 'high' } as any)).toBe('high')
    expect(anthropicEffort('claude-haiku-4-5', {} as any)).toBeUndefined()
  })
})
