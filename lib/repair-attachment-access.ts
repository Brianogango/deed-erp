import 'server-only'
import { getServerSession } from '@/lib/auth/server'
import { loadAppState } from '@/lib/server-store'
import { isRoleAllowed } from '@/lib/auth/authorization'
import { hasModuleAccess } from '@/lib/auth/access'
import { findRepairByPortalRef } from '@/lib/repair-ref'
import { isPortalPhoneVerificationRequired, portalDocumentAccessAllowed } from '@/lib/portal-verify'

/**
 * Access rules for repair attachments — photos, QC reports, diagnosis reports.
 *
 * These endpoints were gated on nothing but "is there a session", so any
 * authenticated user of any role — a sales rep, an HR officer — could upload a
 * QC or diagnosis report against any repair reference, or delete its photos.
 * The photo GET had no gate at all, and sequential refs (REP/2026/0190) are
 * guessable, so the whole device photo set was readable by anyone who could
 * count. portal-verify already names photos and reports as endpoints that its
 * document gate covers; they were simply never wired to it.
 */

export const REPAIR_ATTACHMENT_WRITE_ROLES = ['director', 'admin_officer', 'technical_lead', 'technician']

export type AttachmentWriteDenial = { ok: false; status: number; error: string }
export type AttachmentWriteGrant = { ok: true; user: { id: string; role: string } }

/** Staff-only write gate. Roles are normalized so `lead_tech` is not locked out. */
export async function requireRepairAttachmentWriter(): Promise<AttachmentWriteGrant | AttachmentWriteDenial> {
  const session = await getServerSession()
  if (!session) return { ok: false, status: 401, error: 'Unauthorized' }
  const user = session.user as any
  if (!isRoleAllowed(user?.role, REPAIR_ATTACHMENT_WRITE_ROLES)) {
    return { ok: false, status: 403, error: 'Forbidden' }
  }
  if (!hasModuleAccess(user, 'repair')) {
    return { ok: false, status: 403, error: 'Forbidden — no repair module access' }
  }
  return { ok: true, user }
}

/**
 * Read gate: a staff session, or the customer proving ownership with the phone
 * on file (?phone=), exactly as the invoice/receipt PDF endpoints require.
 */
export async function repairAttachmentReadAllowed(req: { url: string }, repairRef: string): Promise<boolean> {
  const session = await getServerSession()
  if (session) return true

  const state = await loadAppState(['deed_repairs_v2', 'deed_systemSettings'])
  const repairs = Array.isArray(state.deed_repairs_v2) ? state.deed_repairs_v2 as any[] : []
  const repair = findRepairByPortalRef(repairs, repairRef)
  const settings = state.deed_systemSettings as { secPortalRequirePhoneVerification?: boolean } | undefined

  return portalDocumentAccessAllowed(req, repair, {
    phoneVerificationRequired: isPortalPhoneVerificationRequired(settings),
  })
}
