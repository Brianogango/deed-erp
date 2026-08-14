import { describe, expect, it } from 'vitest'
import {
  canApprove,
  createApprovalRequest,
  getPendingApprovals,
  processApproval,
  approvalRecipientIds,
} from '@/lib/sales-approvals'

const users = [
  { id: 'dir-1', name: 'Brian', role: 'director' },
  { id: 'fin-1', name: 'Finance', role: 'finance_officer' },
  { id: 'sales-1', name: 'Cynthia', role: 'sales_rep' },
  { id: 'tl-1', name: 'Lead', role: 'technical_lead' },
]

describe('sales approval authorization', () => {
  it('lets a director approve special_pricing even when approverIds snapshot is empty', () => {
    const request = createApprovalRequest(
      'special_pricing',
      'sales_order',
      'so-1',
      'QUO/2026/0143',
      'sales-1',
      'Cynthia',
      { reason: 'Below list price', value: 4000 },
      [], // no users available at create time
    )

    expect(request.approvers).toHaveLength(1)
    expect(request.approvers[0]?.roles).toEqual(['director', 'finance_officer'])
    expect(request.approvers[0]?.approverIds).toEqual([])
    expect(canApprove(request, 'dir-1', 'director')).toBe(true)
    expect(canApprove(request, 'fin-1', 'finance_officer')).toBe(true)
    expect(canApprove(request, 'tl-1', 'technical_lead')).toBe(false)

    const approved = processApproval(request, 'dir-1', 'Brian', 'approved', undefined, 'director')
    expect(approved.status).toBe('approved')
  })

  it('lets finance alone clear special_pricing without a second director step', () => {
    const request = createApprovalRequest(
      'special_pricing',
      'sales_order',
      'so-1',
      'QUO/2026/0174',
      'sales-1',
      'Cynthia',
      { reason: 'Special pricing: below pricelist', belowPricelist: true },
      users,
    )
    expect(request.approvers).toHaveLength(1)
    const approved = processApproval(request, 'fin-1', 'Finance', 'approved', undefined, 'finance_officer')
    expect(approved.status).toBe('approved')
  })

  it('includes director and finance in notification recipients', () => {
    const request = createApprovalRequest(
      'special_pricing',
      'sales_order',
      'so-1',
      'QUO/2026/0143',
      'sales-1',
      'Cynthia',
      { reason: 'Below list' },
      users,
    )
    const recipients = approvalRecipientIds(request, users)
    expect(recipients).toContain('dir-1')
    expect(recipients).toContain('fin-1')
    expect(recipients).not.toContain('tl-1')
    expect(getPendingApprovals([request], 'dir-1', 'director')).toHaveLength(1)
    expect(getPendingApprovals([request], 'fin-1', 'finance_officer')).toHaveLength(1)
  })

  it('does not create a backorder approval gate', () => {
    const request = createApprovalRequest(
      'backorder',
      'sales_order',
      'so-1',
      'QUO/2026/0143',
      'sales-1',
      'Cynthia',
      { backorderQty: 25 },
      users,
    )
    expect(request.approvers).toEqual([])
  })

  it('does not create a high-value purchase approval gate', () => {
    const request = createApprovalRequest(
      'purchase_high_value',
      'purchase_order',
      'po-1',
      'PO/2026/0100',
      'dir-1',
      'Brian',
      { proposedValue: 250_000, threshold: 50_000 },
      users,
    )
    expect(request.approvers).toEqual([])
  })

  it('rejects unauthorized approvers', () => {
    const request = createApprovalRequest(
      'special_pricing',
      'sales_order',
      'so-1',
      'QUO/2026/0143',
      'sales-1',
      'Cynthia',
      { reason: 'Below list' },
      users,
    )
    expect(() => processApproval(request, 'sales-1', 'Cynthia', 'approved', undefined, 'sales_rep'))
      .toThrow(/not authorized/i)
  })
})
