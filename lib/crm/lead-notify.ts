import 'server-only'
import { publishNotificationEvent } from '@/lib/notifications/service'

/** Tell a rep a lead is now theirs. Never the person who assigned it to themselves. */
export async function notifyLeadAssigned(
  lead: { id: string; name: string; companyName?: string | null; ownerId?: string | null },
  actorId: string,
) {
  if (!lead.ownerId || lead.ownerId === actorId) return
  await publishNotificationEvent({
    eventType: 'crm.lead.assigned',
    entityType: 'lead',
    entityId: lead.id,
    userIds: [lead.ownerId],
    title: 'Lead assigned to you',
    body: `${lead.name}${lead.companyName ? ` · ${lead.companyName}` : ''}`,
    actionUrl: `/crm?crmTab=leads&leadId=${lead.id}`,
    idempotencyKey: `crm-lead-assigned:${lead.id}:${lead.ownerId}`,
  }).catch(() => { /* a missed notice must not fail the save */ })
}
