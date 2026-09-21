/**
 * Browser-originated notifications that describe the same business condition
 * as a server/scanner event must share its eventType + entity, so the
 * scanner's "already open for this entity" check suppresses a second copy.
 */
export function bridgeEventType(entityType: string | null, action: string): string {
  if (entityType === 'quote' && action.startsWith('approval')) return 'sales.quote.approval_required'
  return `app.${entityType}.${action}`
}
