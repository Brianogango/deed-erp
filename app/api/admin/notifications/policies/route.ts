import { NextResponse } from 'next/server'
import { withApiErrorHandling, requirePermission } from '@/lib/auth/api'
import { NOTIFICATION_POLICIES } from '@/lib/notifications/registry'

export const dynamic = 'force-dynamic'

export async function GET() {
  return withApiErrorHandling(async () => {
    await requirePermission('admin.notifications')

    const policies = Object.entries(NOTIFICATION_POLICIES)
      .map(([eventType, policy]) => ({
        eventType,
        channels: policy.channels,
        severity: policy.severity,
        priority: policy.priority,
        recipientRoles: policy.recipientRoles || [],
        requiresAcknowledgement: Boolean(policy.requiresAcknowledgement),
        escalationMinutes: policy.escalationMinutes || null,
        escalationRoles: policy.escalationRoles || [],
        mandatory: Boolean(policy.mandatory),
        mandatoryChannels: policy.mandatoryChannels || [],
        fallbackSms: Boolean(policy.fallbackSms),
      }))
      .sort((a, b) => a.eventType.localeCompare(b.eventType))

    return NextResponse.json({ policies })
  })
}
