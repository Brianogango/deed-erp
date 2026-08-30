export const PRIVILEGED_MFA_ROLES = new Set([
  'director',
  'admin_officer',
  'finance_officer',
])

export function isPrivilegedMfaRole(role: unknown): boolean {
  return typeof role === 'string' && PRIVILEGED_MFA_ROLES.has(role)
}

export function isPrivilegedMfaEnforced(): boolean {
  return process.env.MFA_ENFORCE_PRIVILEGED === 'true'
}

export function requiresPrivilegedMfa(role: unknown): boolean {
  return isPrivilegedMfaEnforced() && isPrivilegedMfaRole(role)
}
