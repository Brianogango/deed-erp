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

    expect(request.approvers[0]?.approverIds).toEqual([])
    expect(canApprove(request, 'dir-1', 'director')).toBe(true)
    expect(canApprove(request, 'fin-1', 'finance_officer')).toBe(false)

    const approved = processApproval(request, 'dir-1', 'Brian', 'approved', undefined, 'director')
    expect(approved.status).toBe('approved')
  })

  it('includes role-matched users in notification recipients', () => {
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
    expect(approvalRecipientIds(request, users)).toContain('dir-1')
    expect(getPendingApprovals([request], 'dir-1', 'director')).toHaveLength(1)
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
