import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// CRM sub-resources follow the parent record's rules: lead attachments and
// the email-review queue use the lead rules, deal activities the deal rules.
const m = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  lead: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  inbound: { findMany: vi.fn(), updateMany: vi.fn() },
  opp: { findUnique: vi.fn(), update: vi.fn() },
  act: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  readFile: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth/server', () => ({ getServerSession: m.getServerSession }))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('@/lib/prisma', () => ({
  default: {
    lead: m.lead, salesInboundEmail: m.inbound, opportunity: m.opp, opportunityActivity: m.act,
    user: { findMany: vi.fn(async () => []) },
  },
}))
vi.mock('@/lib/server-store', () => ({ loadAppState: vi.fn(async () => ({})), saveStoreKeys: vi.fn(), notifyStoreKeysChanged: vi.fn() }))
vi.mock('@/lib/notifications/service', () => ({ publishNotificationEvent: vi.fn() }))
vi.mock('@/lib/crm/lead-attachments', () => ({ readLeadAttachmentFile: m.readFile }))
vi.mock('@/lib/opportunity-activity-read-model.server', () => ({ activityExtras: () => ({}), toScreenActivity: (a: unknown) => a }))

import { GET as attachments } from '@/app/api/leads/[id]/attachments/route'
import { GET as reviewGet, POST as reviewPost } from '@/app/api/crm/email-review/route'
import { POST as actCreate } from '@/app/api/opportunity-activities/route'
import { PUT as actPut, DELETE as actDelete } from '@/app/api/opportunity-activities/[id]/route'

const session = (role: string, id = 'rep-a') => ({ user: { id, name: 'U', username: 'u', role, modules: ['crm', 'sales'] } })
const json = (url: string, method: string, body?: unknown) => new NextRequest(url, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })
const leadOf = (ownerId: string | null, stage = 'needs_review') => ({ id: 'lead-1', ownerId, stage, notes: '', name: 'N', emailAttachments: [{ id: 'f1', name: 'po.pdf', contentType: 'application/pdf' }] })

beforeEach(() => {
  vi.clearAllMocks()
  m.lead.findMany.mockResolvedValue([])
  m.inbound.findMany.mockResolvedValue([])
  m.readFile.mockResolvedValue(Buffer.from('pdf'))
  m.lead.update.mockImplementation(async ({ data }: any) => ({ id: 'lead-1', name: 'N', ...data }))
  m.opp.findUnique.mockResolvedValue({ createdById: 'rep-b', assignedToId: 'rep-b' })
  m.act.findUnique.mockResolvedValue({ id: 'a1', opportunityId: 'opp-1', screenExtras: {} })
})

describe('lead attachments', () => {
  it('a technician, or a rep on a colleague\'s lead, cannot list or download them', async () => {
    m.lead.findUnique.mockResolvedValue(leadOf('rep-b'))
    for (const s of [session('technician'), session('sales_rep')]) {
      m.getServerSession.mockResolvedValue(s)
      expect((await attachments(new NextRequest('http://x/api/leads/lead-1/attachments?file=f1'), { params: Promise.resolve({ id: 'lead-1' }) })).status).toBe(404)
    }
    expect(m.readFile).not.toHaveBeenCalled()
  })

  it('the lead owner can download', async () => {
    m.lead.findUnique.mockResolvedValue(leadOf('rep-a'))
    m.getServerSession.mockResolvedValue(session('sales_rep'))
    expect((await attachments(new NextRequest('http://x/api/leads/lead-1/attachments?file=f1'), { params: Promise.resolve({ id: 'lead-1' }) })).status).toBe(200)
  })
})

describe('email review queue', () => {
  it('is not readable outside CRM roles, and reps see only their own or unassigned', async () => {
    m.getServerSession.mockResolvedValue(session('technician'))
    expect((await reviewGet(new NextRequest('http://x/api/crm/email-review'))).status).toBe(403)
    m.getServerSession.mockResolvedValue(session('sales_rep'))
    expect((await reviewGet(new NextRequest('http://x/api/crm/email-review'))).status).toBe(200)
    expect(m.lead.findMany.mock.calls[0][0].where.AND).toEqual([{ OR: [{ ownerId: 'rep-a' }, { ownerId: null }] }])
  })

  it('a rep cannot close or take a colleague\'s lead, or act on one already reviewed', async () => {
    m.getServerSession.mockResolvedValue(session('sales_rep'))
    m.lead.findUnique.mockResolvedValue(leadOf('rep-b'))
    expect((await reviewPost(json('http://x/api/crm/email-review', 'POST', { leadId: 'lead-1', action: 'reject' }))).status).toBe(404)
    m.lead.findUnique.mockResolvedValue(leadOf(null, 'qualified'))
    expect((await reviewPost(json('http://x/api/crm/email-review', 'POST', { leadId: 'lead-1', action: 'reject' }))).status).toBe(409)
    expect(m.lead.update).not.toHaveBeenCalled()
  })

  it('a rep accepting an unassigned lead cannot hand it to someone else', async () => {
    m.getServerSession.mockResolvedValue(session('sales_rep'))
    m.lead.findUnique.mockResolvedValue(leadOf(null))
    const res = await reviewPost(json('http://x/api/crm/email-review', 'POST', { leadId: 'lead-1', action: 'accept', ownerId: 'rep-b' }))
    expect(res.status).toBe(200)
    expect(m.lead.update.mock.calls[0][0].data.ownerId).not.toBe('rep-b')
  })
})

describe('deal activities', () => {
  it('a technician cannot create activities', async () => {
    m.getServerSession.mockResolvedValue(session('technician'))
    expect((await actCreate(new Request('http://x', { method: 'POST', body: JSON.stringify({ opportunityId: 'opp-1', type: 'call' }) }))).status).toBe(403)
    expect(m.act.create).not.toHaveBeenCalled()
  })

  it('a rep cannot add, edit or delete activities on a colleague\'s deal', async () => {
    m.getServerSession.mockResolvedValue(session('sales_rep'))
    expect((await actCreate(new Request('http://x', { method: 'POST', body: JSON.stringify({ opportunityId: 'opp-1', type: 'call' }) }))).status).toBe(403)
    const p = { params: Promise.resolve({ id: 'a1' }) }
    expect((await actPut(json('http://x', 'PUT', { description: 'x' }), p)).status).toBe(403)
    expect((await actDelete(json('http://x', 'DELETE'), p)).status).toBe(403)
    expect(m.act.update).not.toHaveBeenCalled()
    expect(m.act.delete).not.toHaveBeenCalled()
  })

  it('a rep works on their own deal', async () => {
    m.getServerSession.mockResolvedValue(session('sales_rep'))
    m.opp.findUnique.mockResolvedValue({ createdById: 'rep-a', assignedToId: null })
    m.act.update.mockResolvedValue({ id: 'a1' })
    expect((await actPut(json('http://x', 'PUT', { description: 'x' }), { params: Promise.resolve({ id: 'a1' }) })).status).toBe(200)
  })
})
