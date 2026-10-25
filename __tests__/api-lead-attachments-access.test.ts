import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({ session: { user: { id: 'rep-1', role: 'sales_rep' } } as any, lead: null as any }))

vi.mock('@/lib/auth/api', () => ({
  getRequiredSession: async () => h.session,
  withApiErrorHandling: async (fn: () => Promise<any>) => fn(),
}))
vi.mock('@/lib/prisma', () => ({ default: { lead: { findUnique: async () => h.lead } } }))
vi.mock('@/lib/crm/lead-attachments', () => ({ readLeadAttachmentFile: async () => Buffer.from('file') }))

import { GET } from '@/app/api/leads/[id]/attachments/route'

const att = [{ id: 'a1', name: 'quote.pdf', contentType: 'application/pdf' }]
const call = (qs = '') => GET(new NextRequest(`http://x/api/leads/L1/attachments${qs}`), { params: Promise.resolve({ id: 'L1' }) })

beforeEach(() => { h.session = { user: { id: 'rep-1', role: 'sales_rep' } } })

describe('lead email attachments follow lead ownership', () => {
  it("hides a colleague's lead attachments from a rep", async () => {
    h.lead = { id: 'L1', ownerId: 'rep-2', stage: 'new', emailAttachments: att }
    expect((await call()).status).toBe(404)
    expect((await call('?file=a1')).status).toBe(404)
  })

  it('lets a rep open their own lead and an unassigned one', async () => {
    h.lead = { id: 'L1', ownerId: 'rep-1', stage: 'new', emailAttachments: att }
    expect((await call('?file=a1')).status).toBe(200)
    h.lead = { id: 'L1', ownerId: null, stage: 'new', emailAttachments: att }
    expect((await call()).status).toBe(200)
  })

  it('lets a manager open anyone\'s', async () => {
    h.session = { user: { id: 'boss', role: 'director' } }
    h.lead = { id: 'L1', ownerId: 'rep-2', stage: 'new', emailAttachments: att }
    expect((await call('?file=a1')).status).toBe(200)
  })

  it('keeps roles outside CRM out altogether', async () => {
    h.session = { user: { id: 't1', role: 'technician' } }
    h.lead = { id: 'L1', ownerId: null, stage: 'new', emailAttachments: att }
    expect((await call()).status).toBe(404)
  })
})
